'use strict';

// This process owns the credential. The extension can only submit typed Jev questions.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const UPSTREAM = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-1.13.0';
const CONFIG_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'UI Review', 'jev-config.json');
const MODEL = /^jev-(?:\d{1,3}\.\d{1,3}\.\d{1,3}|latest|preview)$/;
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const description = value => typeof value === 'string' || object(value) || Array.isArray(value);

function jsonSafe(value, depth = 0) {
  if (depth > 32) return false;
  if (value == null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return !/data:(?:image|audio|video)\//i.test(value);
  if (typeof value !== 'object') return false;
  return Object.entries(value).every(([key, item]) => !['__proto__', 'prototype', 'constructor'].includes(key) && jsonSafe(item, depth + 1));
}

function validPayload(body) {
  if (!object(body) || Object.keys(body).some(key => !['model', 'state', 'questions'].includes(key))) return false;
  if (body.model != null && (typeof body.model !== 'string' || !MODEL.test(body.model))) return false;
  if (!own(body, 'state') || !description(body.state) || !jsonSafe(body.state)) return false;
  if (!object(body.questions)) return false;
  const questions = Object.entries(body.questions);
  if (!questions.length || questions.length > 128 || !jsonSafe(body.questions)) return false;
  return questions.every(([id, q]) => {
    if (!id || id.length > 128 || !object(q) || Object.keys(q).some(k => !['type', 'instructions', 'criteria'].includes(k))) return false;
    if (!description(q.instructions) || (typeof q.instructions === 'string' && !q.instructions.trim())) return false;
    if (q.type === 'noul') return q.criteria === undefined || (object(q.criteria) && Object.entries(q.criteria).every(([k, v]) => ['true', 'false'].includes(k) && description(v)));
    if (q.type === 'choice') return object(q.criteria) && Object.keys(q.criteria).length >= 2 && Object.keys(q.criteria).length <= 255 && Object.entries(q.criteria).every(([k, v]) => k.length > 0 && k.length <= 256 && (v === null || description(v)));
    if (q.type === 'score') return Array.isArray(q.criteria) && q.criteria.length >= 2 && q.criteria.length <= 10 && q.criteria.every(description);
    return false;
  });
}

function validAnswers(value, questions) {
  const probability = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
  if (!object(value) || typeof value.model !== 'string' || !MODEL.test(value.model) || !object(value.answers) || !object(value.usage)) return false;
  if (Object.keys(value.answers).length !== Object.keys(questions).length) return false;
  if (!['input_tokens', 'output_tokens'].every(k => Number.isSafeInteger(value.usage[k]) && value.usage[k] >= 0)) return false;
  return Object.entries(questions).every(([id, q]) => {
    const a = value.answers[id];
    if (!object(a) || a.type !== q.type) return false;
    if (q.type === 'noul') return probability(a.noul);
    if (!probability(a.confidence) || !object(a.probabilities)) return false;
    const probabilities = Object.values(a.probabilities);
    if (!probabilities.length || !probabilities.every(probability) || Math.abs(probabilities.reduce((s, p) => s + p, 0) - 1) > 0.02) return false;
    if (q.type === 'choice') return typeof a.choice === 'string' && own(q.criteria, a.choice) && Object.keys(q.criteria).length === probabilities.length && Object.keys(q.criteria).every(k => own(a.probabilities, k));
    const levels = q.criteria.map((_, i) => String(i));
    return typeof a.score === 'number' && Number.isFinite(a.score) && a.score >= 0 && a.score <= q.criteria.length - 1
      && levels.length === probabilities.length && levels.every(k => own(a.probabilities, k))
      && object(a.legend) && Object.keys(a.legend).length === levels.length && levels.every(k => own(a.legend, k)) && jsonSafe(a.legend);
  });
}

function safeAnswer(answer) {
  if (answer.type === 'noul') return { type: answer.type, noul: answer.noul };
  return { type: answer.type, ...(answer.type === 'choice' ? { choice: answer.choice } : { score: answer.score, legend: answer.legend }), confidence: answer.confidence, probabilities: answer.probabilities };
}

function failure(status, code) { return Object.assign(new Error(code), { status, code, localSafe: true }); }

function sanitizeProviderError(body, secret = '', request = null) {
  // Retain diagnostic scalars only. Error envelopes sometimes use detail.error_type
  // (including Jev's max_tokens_exceeded); they are not always error.message.
  const pageText = new Set();
  const collect = (value, depth = 0) => {
    if (depth > 32) return;
    if (typeof value === 'string' && value.length >= 24) pageText.add(value);
    else if (value && typeof value === 'object') for (const v of Object.values(value)) collect(v, depth + 1);
  };
  collect(request);
  for (const value of [request, request?.state, request?.questions]) if (value && typeof value === 'object') pageText.add(JSON.stringify(value));
  const snippets = [...pageText].sort((a, b) => b.length - a.length);
  const clean = value => {
    let text = String(value ?? '');
    if (secret) text = text.split(secret).join('[redacted]');
    for (const snippet of snippets) {
      text = text.split(snippet).join('[request text omitted]');
      text = text.split(JSON.stringify(snippet).slice(1, -1)).join('[request text omitted]');
    }
    return text.replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer [redacted]')
      .replace(/(?:apikey_|sk-)[A-Za-z0-9_\-.]+/gi, '[redacted]')
      .replace(/data:[^\s"'<>]+/gi, '[data omitted]')
      .replace(/["'](?:state|questions|payload|request|input)["']\s*:\s*[\[{][\s\S]*/gi, '[request data omitted]')
      .replace(/```[\s\S]*?```/g, '[quoted data omitted]')
      .replace(/[A-Za-z0-9+/=]{100,}/g, '[long data omitted]')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 600);
  };
  const codes = [], messages = [], params = [];
  const visit = (value, depth = 0) => {
    if (depth > 5 || messages.length >= 4) return;
    if (typeof value === 'string') { messages.push(clean(value)); return; }
    if (Array.isArray(value)) { value.slice(0, 8).forEach(v => visit(v, depth + 1)); return; }
    if (!object(value)) return;
    for (const [key, v] of Object.entries(value).slice(0, 40)) {
      if (/^(?:state|questions|input|body|request|response|headers|authorization|apiKey|api_key|payload)$/i.test(key)) continue;
      if (/^(?:code|type|error_type|error_code|kind)$/.test(key) && ['string', 'number'].includes(typeof v)) codes.push(clean(v).slice(0, 120));
      else if (/^(?:message|msg|reason|error_message|error_description|description)$/.test(key) && ['string', 'number'].includes(typeof v)) messages.push(clean(v));
      else if (/^(?:param|path|field)$/.test(key) && typeof v === 'string') params.push(clean(v).slice(0, 160));
      else if (key === 'loc' && Array.isArray(v) && v.every(x => typeof x === 'string' || typeof x === 'number')) params.push(clean(v.join('.')).slice(0, 160));
      else if (/^(?:error|errors|detail|details|cause)$/.test(key)) visit(v, depth + 1);
    }
  };
  if (typeof body === 'string' && /^\s*<(?:!doctype|html)/i.test(body)) return { code: 'non-json-provider-error', message: '上游返回了网页错误内容，已省略正文' };
  visit(body);
  const result = {};
  if (codes.length) result.code = [...new Set(codes)].slice(0, 3).join('; ');
  if (messages.length) result.message = [...new Set(messages)].slice(0, 3).join('; ').slice(0, 600);
  if (params.length) result.param = [...new Set(params)].slice(0, 3).join('; ').slice(0, 200);
  if (!result.message && /max_tokens_exceeded|context_length|context_window|input_too_long/i.test(result.code || '')) result.message = 'Jev 输入超过模型 token / 上下文限制';
  return result;
}

function bounded(value, fallback, max) { return Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback; }

async function readConfig(configPath, env) {
  let disk = {};
  try {
    const stat = await fs.stat(configPath);
    if (stat.isFile() && stat.size <= 16384) disk = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch { /* Missing/invalid config is reported as configured:false, never echoed. */ }
  const apiKey = typeof env.JEV_API_KEY === 'string' && env.JEV_API_KEY.trim() ? env.JEV_API_KEY.trim() : (typeof disk?.apiKey === 'string' ? disk.apiKey.trim() : '');
  const candidate = disk?.model || DEFAULT_MODEL;
  const model = typeof candidate === 'string' && MODEL.test(candidate) ? candidate : DEFAULT_MODEL;
  return { apiKey: apiKey.length <= 4096 && !/[\r\n]/.test(apiKey) ? apiKey : '', model };
}

function readBody(req, limit, signal) {
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0;
    const cleanup = () => { req.off('data', data); req.off('end', end); req.off('error', error); signal.removeEventListener('abort', aborted); };
    const error = () => { cleanup(); reject(failure(400, 'request-interrupted')); };
    const aborted = () => { cleanup(); req.resume(); reject(failure(504, 'request-timeout')); };
    const data = chunk => {
      bytes += chunk.length;
      if (bytes > limit) { cleanup(); req.resume(); reject(failure(413, 'request-too-large')); }
      else chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(failure(400, 'invalid-json')); }
    };
    req.on('data', data); req.on('end', end); req.on('error', error); signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

async function readResponse(response, limit, signal, asText = false) {
  if (!response.body?.getReader) throw failure(502, 'invalid-upstream-response');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = '', bytes = 0;
  const abort = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw failure(502, 'upstream-response-too-large');
      text += decoder.decode(chunk.value, { stream: true });
    }
    if (signal.aborted) throw failure(504, 'upstream-timeout');
    text += decoder.decode();
    if (asText) return text;
    try { return JSON.parse(text); } catch { throw failure(502, 'invalid-upstream-json'); }
  } finally { signal.removeEventListener('abort', abort); try { await reader.cancel(); } catch {} }
}

function createServer(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const configPath = options.configPath || CONFIG_PATH;
  const env = options.env || process.env;
  const timeoutMs = bounded(options.timeoutMs, 45000, 60000);
  const maxBodyBytes = bounded(options.maxBodyBytes, 262144, 1048576);
  const maxResponseBytes = bounded(options.maxResponseBytes, 524288, 1048576);
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    const origin = req.headers.origin;
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host || '')) return send(403, { error: { code: 'host-not-allowed' } });
    if (origin && !EXTENSION_ORIGIN.test(origin)) return send(403, { error: { code: 'origin-not-allowed' } });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
    }
    const route = req.url;
    if (!['/health', '/systemone'].includes(route)) return send(404, { error: { code: 'not-found' } });
    if (req.method === 'OPTIONS') {
      const method = req.headers['access-control-request-method'];
      const headers = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
      if (!origin || method !== (route === '/health' ? 'GET' : 'POST') || headers.some(h => !['content-type', 'x-ui-review'].includes(h))) return send(403, { error: { code: 'preflight-not-allowed' } });
      res.setHeader('Access-Control-Allow-Methods', route === '/health' ? 'GET, OPTIONS' : 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-UI-Review');
      res.setHeader('Access-Control-Max-Age', '600');
      if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.writeHead(204); return res.end();
    }
    if (route === '/health' && req.method === 'GET') {
      const cfg = await readConfig(configPath, env);
      return send(200, { provider: 'jev', model: cfg.model, configured: !!cfg.apiKey });
    }
    if (route !== '/systemone' || req.method !== 'POST') return send(405, { error: { code: 'method-not-allowed' } });
    if (!origin || req.headers['x-ui-review'] !== 'jev-v1') return send(403, { error: { code: 'extension-request-required' } });
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return send(415, { error: { code: 'json-required' } });
    if (Number(req.headers['content-length']) > maxBodyBytes) return send(413, { error: { code: 'request-too-large' } });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', cancel); res.once('close', cancel);
    let rejectAbort;
    const deadline = new Promise((_, reject) => {
      rejectAbort = () => reject(failure(504, 'upstream-timeout'));
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    try {
      await Promise.race([deadline, (async () => {
        const body = await readBody(req, maxBodyBytes, controller.signal);
        if (!validPayload(body)) throw failure(400, 'invalid-systemone-payload');
        const cfg = await readConfig(configPath, env);
        if (!cfg.apiKey) throw failure(503, 'jev-not-configured');
        if (controller.signal.aborted) throw failure(504, 'upstream-timeout');
        const response = await fetchImpl(UPSTREAM, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` }, body: JSON.stringify({ model: body.model || cfg.model, state: body.state, questions: body.questions }), signal: controller.signal });
        if (!response.ok) {
          // Bounded diagnostic fields distinguish provider input limits from a
          // local schema rejection without returning echoed pages or credentials.
          let providerError = {};
          try {
            const text = await readResponse(response, 16384, controller.signal, true);
            let detail; try { detail = JSON.parse(text); } catch { detail = text; }
            providerError = sanitizeProviderError(detail, cfg.apiKey, body);
          } catch (error) {
            providerError = { code: error?.localSafe ? error.code : 'provider-error-unreadable' };
          }
          const status = [400, 401, 402, 403, 404, 413, 422, 429, 529].includes(response.status) ? response.status : 502;
          if ([429, 529].includes(status)) {
            const retry = Number(response.headers?.get?.('retry-after'));
            if (Number.isFinite(retry) && retry >= 0) res.setHeader('Retry-After', String(Math.min(300, Math.ceil(retry))));
          }
          throw Object.assign(failure(status, `jev-http-${response.status}`), { providerError, errorSource: 'upstream' });
        }
        const value = await readResponse(response, maxResponseBytes, controller.signal);
        if (!validAnswers(value, body.questions)) throw failure(502, 'invalid-systemone-answers');
        const result = { model: value.model, answers: Object.fromEntries(Object.entries(value.answers).map(([k, a]) => [k, safeAnswer(a)])), usage: { input_tokens: value.usage.input_tokens, output_tokens: value.usage.output_tokens } };
        if (JSON.stringify(result).includes(cfg.apiKey)) throw failure(502, 'invalid-upstream-response');
        send(200, result);
      })()]);
    } catch (error) {
      const status = error?.localSafe && Number.isInteger(error.status) ? error.status : 502;
      const code = error?.localSafe ? error.code : 'jev-upstream-unavailable';
      send(status, { error: { code, source: error?.errorSource || 'local', ...(error?.localSafe && error.providerError ? { providerError: error.providerError } : {}) } });
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', rejectAbort);
      req.off('aborted', cancel); res.off('close', cancel); controller.abort();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 1000;
  return server;
}

if (require.main === module) {
  const server = createServer();
  server.on('error', () => { console.error('Jev 本机服务启动失败，请检查 4320 端口。'); process.exitCode = 1; });
  server.listen(4320, '127.0.0.1', () => console.log('Jev 本机服务已启动：127.0.0.1:4320'));
}

module.exports = { createServer, validPayload, validAnswers, sanitizeProviderError, CONFIG_PATH, DEFAULT_MODEL };
