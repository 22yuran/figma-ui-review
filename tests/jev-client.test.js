'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const J = require('../chrome-ui-review-extension/jev-client.js');
const questions = { pair: { type: 'choice', instructions: 'Which candidate has the same function?', criteria: { candidate: 'same function', none: 'no corresponding object' } } };
const result = { model: 'jev-1.13.0', answers: { pair: { type: 'choice', choice: 'candidate', confidence: 0.92, probabilities: { candidate: 0.96, none: 0.04 } } }, usage: { input_tokens: 126, output_tokens: 20 } };
const reply = (value = result, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
async function main() {
  const browser = {}; vm.runInNewContext(fs.readFileSync(require.resolve('../chrome-ui-review-extension/jev-client.js'), 'utf8'), browser);
  for (const api of [J, browser.JevClient]) for (const method of ['request', 'health', 'createSession', 'unavailableReason', 'sanitizeError', 'errorDetails']) assert.equal(typeof api[method], 'function');
  const secret = 'PRIVATE-LOCAL-KEY', cfg = { model: 'jev-1.13.0', session: J.createSession() };
  assert.equal(J.unavailableReason(cfg), '', 'no extension API key is needed');
  let called = 0, request; const progress = [];
  const output = await J.request({ cfg, state: { label: '去发品' }, questions, onProgress: p => progress.push(p), fetchImpl: async (url, options) => {
    called++; assert.equal(url, 'http://127.0.0.1:4320/systemone'); assert.equal(options.headers['X-UI-Review'], 'jev-v1');
    assert(!options.headers.Authorization); assert.equal(options.redirect, 'error'); request = JSON.parse(options.body); return reply();
  } });
  assert.deepEqual(Object.keys(request).sort(), ['model', 'questions', 'state']); assert.deepEqual(output.value, result); assert.deepEqual(output.usage, result.usage);
  assert.equal(output.diagnostics.transport, 'json'); assert.equal(output.diagnostics.phase, 'complete'); assert(progress.length >= 2);
  assert.equal(cfg.session.budget.calls, 1); assert(!JSON.stringify(cfg.session).includes('去发品'));
  await assert.rejects(J.request({ cfg, state: { label: '去发品' }, questions, fetchImpl: () => { called++; throw Error('duplicate'); } }), /相同证据/);
  assert.equal(called, 1);
  const health = await J.health({ fetchImpl: async (url, options) => { assert.equal(url, 'http://127.0.0.1:4320/health'); assert(!options.headers.Authorization); return reply({ provider: 'jev', model: result.model, configured: true, apiKey: secret }); } });
  assert.deepEqual(health, { provider: 'jev', model: result.model, configured: true }); assert(!JSON.stringify(health).includes(secret));
  assert(J.unavailableReason({ configured: false }).includes('尚未配置'));
  await assert.rejects(J.health({ totalMs: 15, fetchImpl: async () => new Promise(() => {}) }), /超时/);
  for (const code of [401, 403, 429, 503, 529]) {
    const blocked = { session: J.createSession() }; let n = 0;
    const fail = () => J.request({ cfg: blocked, state: 'one', questions, fetchImpl: async () => { n++; return reply({ error: { message: `Bearer ${secret}`, body: 'DO-NOT-PERSIST-PAYLOAD' } }, code, { 'Retry-After': '2' }); } });
    await assert.rejects(fail(), error => { assert.equal(error.diagnostics.httpStatus, code); assert(!JSON.stringify(error).includes(secret)); assert(!JSON.stringify(error).includes('DO-NOT-PERSIST')); return true; });
    assert(blocked.session.blocked); await assert.rejects(fail(), /本轮 Jev 请求已停止/); assert.equal(n, 1, 'blocked requests do not silently consume the remaining budget');
    assert.equal(blocked.session.budget.calls, 1);
    assert.equal(J.unavailableReason({ session: J.createSession() }), '', 'a new review has a fresh session');
  }
  const local = { session: J.createSession() };
  await assert.rejects(J.request({ cfg: local, state: 'invalid packet', questions, fetchImpl: async () => reply({}, 422) }), /422/);
  assert(!local.session.blocked); await J.request({ cfg: local, state: 'other packet', questions, fetchImpl: async () => reply() });
  const contextSession = { session: J.createSession(), apiKey: secret };
  await assert.rejects(J.request({ cfg: contextSession, state: 'oversize evidence', questions, fetchImpl: async () => reply({ error: {
    code: 'jev-http-400', source: 'upstream', providerError: { code: 'max_tokens_exceeded', message: 'Jev 输入超过模型 token / 上下文限制', payload: 'PRIVATE-PAGE' }
  } }, 400) }), error => {
    assert.equal(error.diagnostics.failureKind, 'input-limit'); assert.equal(error.diagnostics.errorSource, 'upstream');
    assert.equal(error.diagnostics.providerError.code, 'max_tokens_exceeded'); assert.match(error.message, /max_tokens_exceeded/);
    const detail = J.errorDetails(error); assert.equal(detail.diagnostics.providerError.code, 'max_tokens_exceeded'); assert(!JSON.stringify(detail).includes('PRIVATE-PAGE')); return true;
  });
  assert(!contextSession.session.blocked, 'one overlong packet must not block smaller independent packets');
  await J.request({ cfg: contextSession, state: 'small independent evidence', questions, fetchImpl: async () => reply() });
  await assert.rejects(J.request({ state: '', questions, fetchImpl: async () => reply({ error: { code: 'invalid-systemone-payload', source: 'local' } }, 400) }), error => error.diagnostics.errorSource === 'local' && /invalid-systemone-payload/.test(error.message));
  for (const limits of [{ maxCalls: 0 }, { maxAiMs: 0 }, { maxTextBytes: 2 }, { maxRequestBytes: 2 }]) {
    const limited = { session: J.createSession(limits) };
    await assert.rejects(J.request({ cfg: limited, state: 'bounded', questions, fetchImpl: () => { throw Error('must not fetch'); } }), /预算/);
    assert.equal(limited.session.budget.calls, 0);
  }
  let signal;
  await assert.rejects(J.request({ cfg: {}, state: '', questions, totalMs: 15, fetchImpl: async (_, options) => { signal = options.signal; return new Promise(() => {}); } }), error => error.diagnostics.timeoutKind === 'total');
  assert(signal.aborted, 'deadline aborts even when a transport stub does not reject');
  await assert.rejects(J.request({ cfg: {}, state: '', questions, fetchImpl: async () => reply({ ...result, answers: {} }) }), /answers/);
  await assert.rejects(J.request({ cfg: {}, state: '', questions, fetchImpl: async () => new Response('{bad json') }), /JSON/);
  await assert.rejects(J.request({ cfg: {}, state: '', questions, fetchImpl: async () => new Response('x'.repeat(524289)) }), /大小/);
  const text = J.sanitizeError(`Bearer apikey_1234-secret apikey_SECOND.value ${secret}`, secret);
  assert(!text.includes(secret)); assert(!text.includes('apikey_'));
  const hostile = new Proxy({}, { get() { throw Error(secret); }, ownKeys() { throw Error(secret); } });
  assert.doesNotThrow(() => J.sanitizeError(hostile)); assert.doesNotThrow(() => J.errorDetails(hostile));
  const details = J.errorDetails(Object.assign(Error(secret), { diagnostics: { httpStatus: 401, request: { apiKey: secret }, state: 'PRIVATE-PAGE', questions }, cause: { payload: 'PRIVATE-PAGE' } }), secret);
  assert.equal(details.diagnostics.httpStatus, 401); assert(!JSON.stringify(details).includes(secret)); assert(!JSON.stringify(details).includes('PRIVATE-PAGE'));
  const providerSecret = J.errorDetails({ message: 'failure', diagnostics: { providerError: { code: 'bad_request', message: `Bearer ${secret} apikey_OTHER ${secret}`, request: 'PRIVATE-PAGE' } } }, secret);
  assert(!JSON.stringify(providerSecret).includes(secret)); assert(!JSON.stringify(providerSecret).includes('apikey_OTHER')); assert(!JSON.stringify(providerSecret).includes('PRIVATE-PAGE'));
  console.log('Jev client: browser/CommonJS API, typed loopback transport, no browser credential, bounded JSON/deadlines, health, budget, 401/403/429/529 session stop and sanitized metadata passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
