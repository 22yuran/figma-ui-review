/* Jev transport: typed JSON through a credential-owning loopback service. */
(function(root, factory) { const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.JevClient = api; })(globalThis, function() {
  'use strict';
  const BASE = 'http://127.0.0.1:4320';
  const DEFAULT_MODEL = 'jev-1.13.0';
  const MODEL = /^jev-(?:\d{1,3}\.\d{1,3}\.\d{1,3}|latest|preview)$/;
  const bytes = value => new TextEncoder().encode(value).length;
  const read = (value, key) => { try { return value?.[key]; } catch { return undefined; } };
  function sanitizeError(value, secret = '') {
    let text = '', known = '';
    try { text = String(value ?? ''); } catch { text = '无法读取错误信息'; }
    try { known = String(secret || ''); } catch {}
    if (known) text = text.split(known).join('[redacted]');
    return text.replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer [redacted]')
      .replace(/(?:apikey_|sk-)[A-Za-z0-9_\-.]+/gi, '[redacted]')
      .replace(/data:(?:image|audio|video)\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, '[media omitted]')
      .replace(/[A-Za-z0-9+/=]{100,}/g, '[long data omitted]').slice(0, 600);
  }
  function providerFields(value, secret = '') {
    const result = {};
    for (const key of ['code', 'message', 'param']) {
      const v = read(value, key);
      if (typeof v === 'string' || typeof v === 'number') result[key] = sanitizeError(v, secret);
    }
    return result;
  }
  function errorDetails(error, secret = '') {
    try {
      const details = { message: sanitizeError(read(error, 'message') ?? error, secret) || '未知错误' };
      if (read(error, 'name')) details.name = sanitizeError(read(error, 'name'), secret);
      const source = read(error, 'diagnostics');
      if (source && typeof source === 'object') {
        const clean = {};
        // Allowlist transport metadata. Never persist payload/state/questions or arbitrary causes.
        for (const key of ['provider', 'model', 'transport', 'phase', 'failedPhase', 'httpStatus', 'elapsedMs', 'headersMs', 'totalTimeoutMs', 'timeoutKind', 'failureKind', 'requestBytes', 'textBytes', 'retryAfterMs', 'code', 'errorSource']) {
          const value = read(source, key);
          if (value == null || typeof value === 'number' || typeof value === 'boolean') { if (value !== undefined) clean[key] = value; }
          else if (typeof value === 'string') clean[key] = sanitizeError(value, secret);
        }
        if (read(source, 'providerError')) clean.providerError = providerFields(read(source, 'providerError'), secret);
        details.diagnostics = clean;
      }
      return details;
    } catch { return { message: '无法读取错误信息' }; }
  }
  function createSession(limits = {}) {
    return { budget: { maxCalls: limits.maxCalls ?? 12, maxAiMs: limits.maxAiMs ?? 120000,
      maxTextBytes: limits.maxTextBytes ?? 96000, maxRequestBytes: limits.maxRequestBytes ?? 262144,
      totalMs: limits.totalMs ?? 45000, idleMs: limits.idleMs ?? 20000,
      startedAt: null, usedAiMs: 0, calls: 0, requests: [], fingerprints: [] } };
  }
  function unavailableReason(cfg) {
    if (cfg?.session?.blocked) return `本轮 Jev 请求已停止：${errorDetails(cfg.session.blocked, cfg.apiKey).message}`;
    if (cfg?.configured === false) return sanitizeError(cfg.connectionError || 'Jev 本机服务尚未配置密钥');
    const b = cfg?.session?.budget;
    if (b && (b.calls >= b.maxCalls || b.usedAiMs >= b.maxAiMs)) return '本轮自动复核已达到调用或时间预算';
    return '';
  }
  function fingerprint(value) { let h = 2166136261; for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619); return (h >>> 0).toString(16) + ':' + value.length; }
  async function responseJSON(response, signal, limit = 524288) {
    if (!response.body?.getReader) throw Error('Jev 本机服务响应不可读取');
    const reader = response.body.getReader(), decoder = new TextDecoder(); let text = '', size = 0;
    const cancel = () => { reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      while (!signal.aborted) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength; if (size > limit) throw Error('Jev 响应超过大小限制');
        text += decoder.decode(chunk.value, { stream: true });
      }
      if (signal.aborted) throw Error('Jev 请求超时');
      let result; try { result = JSON.parse(text + decoder.decode()); } catch { throw Error('Jev 响应 JSON 无效'); }
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error('Jev 响应必须是对象');
      return result;
    } finally { signal.removeEventListener('abort', cancel); try { await reader.cancel(); } catch {} }
  }
  function resultValid(value, questions) {
    if (!value?.answers || typeof value.answers !== 'object' || Array.isArray(value.answers) || !MODEL.test(value.model || '') || !value.usage || typeof value.usage !== 'object') return false;
    if (Object.keys(value.answers).length !== Object.keys(questions).length) return false;
    return Object.entries(questions).every(([key, q]) => value.answers[key]?.type === q.type);
  }
  function timeoutError() { return Object.assign(Error('Jev 整次请求超时'), { isJevTimeout: true }); }
  async function health({ fetchImpl = globalThis.fetch, totalMs = 3000 } = {}) {
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([(async () => {
        const response = await fetchImpl(BASE + '/health', { method: 'GET', headers: { 'X-UI-Review': 'jev-v1' }, cache: 'no-store', redirect: 'error', signal: controller.signal });
        if (!response.ok) throw Error('Jev 本机服务健康检查失败');
        const value = await responseJSON(response, controller.signal, 4096);
        if (value.provider !== 'jev' || typeof value.configured !== 'boolean' || !MODEL.test(value.model || '')) throw Error('Jev 本机服务健康检查返回无效');
        return { provider: 'jev', model: value.model, configured: value.configured };
      })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(timeoutError()); }, Math.min(Math.max(1, totalMs), 10000)); })]);
    } catch (error) { throw Error(error?.isJevTimeout ? 'Jev 本机服务健康检查超时' : 'Jev 本机服务未连接，请先启动本机服务'); }
    finally { clearTimeout(timer); controller.abort(); }
  }
  async function request({ cfg = {}, state, questions, totalMs = 45000, onProgress = () => {}, fetchImpl = globalThis.fetch }) {
    const model = cfg.model || DEFAULT_MODEL, budget = cfg.session?.budget, start = Date.now();
    const reason = unavailableReason(cfg);
    if (reason) { const error = Error(reason); error.diagnostics = { provider: 'jev', phase: 'skipped', elapsedMs: 0, failureKind: cfg.session?.blocked ? 'connection' : 'budget' }; throw error; }
    totalMs = Math.max(1, Math.min(Number.isFinite(totalMs) ? totalMs : 45000, 60000, budget?.totalMs ?? 60000, budget ? budget.maxAiMs - budget.usedAiMs : 60000));
    const diagnostics = { provider: 'jev', model: MODEL.test(model) ? model : DEFAULT_MODEL, transport: 'json', phase: 'budget-check', totalTimeoutMs: totalMs };
    const progress = () => { try { onProgress({ ...diagnostics, elapsedMs: Date.now() - start }); } catch {} };
    const controller = new AbortController(); let timer, progressTimer, record, timedOut = false;
    try {
      if (!MODEL.test(model) || !questions || typeof questions !== 'object' || Array.isArray(questions) || !Object.keys(questions).length || state === undefined) throw Error('Jev 请求缺少有效的 model、state 或 questions');
      let encoded; try { encoded = JSON.stringify({ model, state, questions }); } catch { throw Error('Jev 请求数据无法序列化'); }
      diagnostics.requestBytes = bytes(encoded); diagnostics.textBytes = diagnostics.requestBytes;
      if (diagnostics.requestBytes > Math.min(262144, budget?.maxRequestBytes ?? 262144) || diagnostics.textBytes > (budget?.maxTextBytes ?? 96000)) { diagnostics.failureKind = 'budget'; throw Error('Jev 局部证据超过单次输入预算'); }
      const key = fingerprint(encoded);
      if (budget) {
        if (budget.fingerprints.includes(key)) { diagnostics.failureKind = 'budget'; throw Error('Jev 相同证据已请求，停止重复调用'); }
        budget.startedAt ??= start; budget.calls++; budget.fingerprints.push(key);
        record = { index: budget.calls, textBytes: diagnostics.textBytes, requestBytes: diagnostics.requestBytes, status: 'running' }; budget.requests.push(record);
      }
      diagnostics.phase = 'connecting'; progress(); progressTimer = setInterval(progress, 1000);
      const value = await Promise.race([(async () => {
        const response = await fetchImpl(BASE + '/systemone', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-UI-Review': 'jev-v1' }, body: encoded, cache: 'no-store', redirect: 'error', signal: controller.signal });
        diagnostics.httpStatus = response.status; diagnostics.headersMs = Date.now() - start; diagnostics.phase = 'receiving'; progress();
        if (!response.ok) {
          // Only the trusted local envelope's scalar diagnostics are retained.
          // Old services may return just a code; continue to support that shape.
          let envelope;
          try { envelope = await responseJSON(response, controller.signal, 16384); } catch {}
          const error = envelope?.error;
          if (typeof error?.code === 'string') diagnostics.code = sanitizeError(error.code, cfg.apiKey);
          if (['local', 'upstream'].includes(error?.source)) diagnostics.errorSource = error.source;
          diagnostics.providerError = providerFields(error?.providerError, cfg.apiKey);
          diagnostics.phase = 'request-rejected';
          if ([429, 529].includes(response.status)) {
            const retry = Number(response.headers?.get?.('retry-after'));
            diagnostics.retryAfterMs = Number.isFinite(retry) && retry >= 0 ? Math.min(retry * 1000, 300000) : null;
            diagnostics.failureKind = 'rate-limit';
          } else diagnostics.failureKind = [401, 402, 403, 404, 503].includes(response.status) ? 'connection' : [400, 413, 422].includes(response.status) ? 'request' : 'transport';
          const providerReason = [diagnostics.providerError.code, diagnostics.providerError.message].filter(Boolean).join(' · ');
          if ([400, 413, 422].includes(response.status) && /max_tokens_exceeded|context[_ -]?(?:length|window)|input[_ -]too[_ -]long|maximum.*tokens|tokens.*(?:maximum|limit)|token.*上下文限制/i.test(providerReason)) diagnostics.failureKind = 'input-limit';
          const hint = { 400: '请求参数无效', 401: '密钥无效，请检查本机配置', 402: '调用余额不足', 403: '调用权限或插件来源未获允许', 404: '模型或本机接口不存在', 413: '请求内容过大', 422: '问题格式不符合 Jev 接口要求', 429: '服务限流，本轮停止继续请求；稍后重新走查', 503: '本机服务尚未配置密钥', 504: '模型请求超时', 529: '服务繁忙，本轮停止继续请求；稍后重新走查' }[response.status] || '模型服务暂时不可用';
          throw Error(`Jev HTTP ${response.status}：${providerReason || (diagnostics.code ? hint + '（' + diagnostics.code + '）' : hint)}`);
        }
        const data = await responseJSON(response, controller.signal);
        if (!resultValid(data, questions)) throw Error('Jev 返回的 answers 与问题不对应');
        return data;
      })(), new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; controller.abort(); reject(timeoutError()); }, totalMs); })]);
      diagnostics.phase = 'complete'; diagnostics.model = value.model; diagnostics.elapsedMs = Date.now() - start; progress();
      return { value, model: value.model, usage: value.usage, diagnostics };
    } catch (error) {
      const failedPhase = diagnostics.phase;
      diagnostics.phase = 'failed'; diagnostics.failedPhase = failedPhase; diagnostics.elapsedMs = Date.now() - start;
      diagnostics.timeoutKind = timedOut ? 'total' : null;
      diagnostics.failureKind ||= timedOut ? 'timeout' : 'transport';
      const message = timedOut ? 'Jev 整次请求超时' : (/^Jev /.test(read(error, 'message') || '') ? sanitizeError(error.message, cfg.apiKey) : '无法连接 Jev 本机服务或完成请求');
      const failure = Error(message); failure.diagnostics = diagnostics;
      if (cfg.session && ['connection', 'rate-limit'].includes(diagnostics.failureKind)) cfg.session.blocked = errorDetails(failure, cfg.apiKey);
      throw failure;
    } finally {
      clearTimeout(timer); clearInterval(progressTimer); controller.abort();
      if (record) { const elapsedMs = Date.now() - start; budget.usedAiMs += elapsedMs; Object.assign(record, { status: diagnostics.phase, httpStatus: diagnostics.httpStatus || null, elapsedMs, failureKind: diagnostics.failureKind || null }); }
    }
  }
  return { request, health, createSession, unavailableReason, errorDetails, sanitizeError };
});
