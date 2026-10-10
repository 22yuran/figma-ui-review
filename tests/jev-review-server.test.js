'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createServer, validPayload, validAnswers, sanitizeProviderError } = require('../services/jev-review-server.cjs');
const origin = 'chrome-extension://' + 'a'.repeat(32);
const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-UI-Review': 'jev-v1' };
const payload = { model: 'jev-1.13.0', state: { label: '去发品', candidate: '发布商品' }, questions: { same: { type: 'noul', instructions: 'Are these the same button?', criteria: { true: 'Same action', false: 'Different actions' } } } };
const response = { model: 'jev-1.13.0', answers: { same: { type: 'noul', noul: 0.98 } }, usage: { input_tokens: 200, output_tokens: 20 } };
async function withServer(options, test) {
  const server = createServer(options); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await test(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-server-test-'));
  const configPath = path.join(dir, 'config.json'), secret = 'apikey_UNIT-TEST-ONLY';
  try {
    await fs.writeFile(configPath, JSON.stringify({ apiKey: secret, model: 'jev-1.13.0' }), { mode: 0o600 });
    let called = 0, mode = 'ok', upstreamSignal;
    await withServer({ configPath, env: {}, timeoutMs: 80, fetchImpl: async (url, options) => {
      called++; assert.equal(url, 'https://api.typesafe.ai/v1/systemone'); assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer ' + secret);
      assert.deepEqual(JSON.parse(options.body), payload); upstreamSignal = options.signal;
      if (mode === 'never') return new Promise(() => {});
      if (mode === 'throw') throw Object.assign(Error(secret), { code: secret, payload });
      if (mode === 'large') return new Response('x'.repeat(524289));
      if (mode === 'invalid') return new Response('{bad json');
      if (mode === 'badanswers') return new Response(JSON.stringify({ ...response, answers: {} }));
      if (mode === 'tokens') return new Response(JSON.stringify({ detail: { error_type: 'max_tokens_exceeded' } }), { status: 400 });
      if (mode === 'secret') return new Response(JSON.stringify({ ...response, answers: { same: { type: 'noul', noul: 0.98, ignoredSecret: secret } }, apiKey: secret, payload }));
      if (typeof mode === 'number') return new Response(JSON.stringify({ error: { message: secret, payload } }), { status: mode, headers: { 'Retry-After': '3' } });
      return new Response(JSON.stringify(response));
    } }, async base => {
      const call = (body = payload, extra = {}) => fetch(base + '/systemone', { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
      assert.deepEqual(await (await fetch(base + '/health')).json(), { provider: 'jev', model: 'jev-1.13.0', configured: true });
      const ok = await call(); assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), response);
      const before = called;
      for (const bad of ['https://evil.example', 'null', 'chrome-extension://short', origin + '.evil.example', 'chrome-extension://' + 'z'.repeat(32)]) assert.equal((await call(payload, { Origin: bad })).status, 403);
      assert.equal((await call(payload, { 'X-UI-Review': '' })).status, 403);
      assert.equal((await fetch(base + '/systemone', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-UI-Review': 'jev-v1' }, body: JSON.stringify(payload) })).status, 403);
      await new Promise((resolve, reject) => {
        const req = http.request(base + '/systemone', { method: 'POST', headers: { ...headers, Host: 'evil.example' } }, res => {
          res.resume(); res.on('end', () => { try { assert.equal(res.statusCode, 403); resolve(); } catch (e) { reject(e); } });
        });
        req.on('error', reject); req.end(JSON.stringify(payload));
      });
      assert.equal((await call(payload, { 'Content-Type': 'text/plain' })).status, 415);
      assert.equal((await fetch(base + '/health', { headers: { Origin: 'https://evil.example' } })).status, 403);
      assert.equal((await fetch(base + '/health?key=anything')).status, 404);
      const preflight = await fetch(base + '/systemone', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-ui-review', 'Access-Control-Request-Private-Network': 'true' } });
      assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), origin); assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
      assert.equal((await fetch(base + '/systemone', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' } })).status, 403);
      for (const invalid of [{}, { ...payload, endpoint: 'https://evil.example' }, { ...payload, apiKey: secret }, { ...payload, model: 'gpt-anything' }, { ...payload, questions: { a: { type: 'chat', instructions: 'hello' } } }, { ...payload, state: 'data:image/png;base64,AAAA' }, { ...payload, questions: {} }]) assert.equal((await call(invalid)).status, 400);
      assert.equal(called, before, 'bad origins and bad schemas never reach the upstream');
      for (const httpStatus of [401, 403, 422, 429, 529]) {
        mode = httpStatus; const r = await call(); assert.equal(r.status, httpStatus); const text = await r.text(); assert(!text.includes(secret)); assert(!text.includes('去发品'));
        if ([429, 529].includes(httpStatus)) assert.equal(r.headers.get('retry-after'), '3');
      }
      mode = 'tokens'; const tokens = await call(); assert.equal(tokens.status, 400);
      const tokenError = (await tokens.json()).error; assert.equal(tokenError.source, 'upstream'); assert.equal(tokenError.providerError.code, 'max_tokens_exceeded'); assert.match(tokenError.providerError.message, /token/);
      for (const m of ['throw', 'large', 'invalid', 'badanswers']) { mode = m; const r = await call(); assert.equal(r.status, 502); assert(!(await r.text()).includes(secret)); }
      mode = 'secret'; const redacted = await call(); assert.equal(redacted.status, 200); assert.deepEqual(await redacted.json(), response, 'unrecognized upstream fields are discarded');
      mode = 'never'; const timeout = await call(); assert.equal(timeout.status, 504); assert(upstreamSignal.aborted);
      const oversized = await call({ ...payload, state: 'x'.repeat(262144) }); assert.equal(oversized.status, 413);
    });
    await withServer({ configPath: path.join(dir, 'missing.json'), env: {}, fetchImpl: () => { throw Error('must not call'); } }, async base => {
      assert.equal((await (await fetch(base + '/health')).json()).configured, false);
      assert.equal((await fetch(base + '/systemone', { method: 'POST', headers, body: JSON.stringify(payload) })).status, 503);
    });
    await withServer({ configPath, env: { JEV_API_KEY: 'ENV-ONLY-TEST-KEY' }, fetchImpl: async (_, options) => { assert.equal(options.headers.Authorization, 'Bearer ENV-ONLY-TEST-KEY'); return new Response(JSON.stringify(response)); } }, async base => {
      assert.equal((await fetch(base + '/systemone', { method: 'POST', headers, body: JSON.stringify(payload) })).status, 200);
    });
    await withServer({ configPath, env: {}, timeoutMs: 25, fetchImpl: () => { throw Error('must not call'); } }, async base => {
      await new Promise((resolve, reject) => {
        const req = http.request(base + '/systemone', { method: 'POST', headers }, res => { let text = ''; res.on('data', c => text += c); res.on('end', () => { try { assert.equal(res.statusCode, 504); resolve(); } catch (e) { reject(e); } }); });
        req.on('error', reject); req.write('{'); // A stalled request body must not remain open forever.
      });
    });
    assert(validPayload(payload));
    const score = { ...payload, questions: { rank: { type: 'score', instructions: { criterion: 'same role' }, criteria: ['different', 'possible', 'same'] } } };
    assert(validPayload(score));
    assert(validAnswers({ model: payload.model, answers: { rank: { type: 'score', score: 1.9, probabilities: { 0: 0, 1: 0.1, 2: 0.9 }, confidence: 0.9, legend: { 0: 'different', 1: 'possible', 2: 'same' } } }, usage: response.usage }, score.questions));
    assert(!validPayload(JSON.parse('{"state":"x","questions":{"__proto__":{"type":"noul","instructions":"x"}}}')));
    const longPageText = 'Private shop customer order details that must not be included in a diagnostic';
    const safe = sanitizeProviderError({ detail: [{ type: 'invalid_question', loc: ['body', 'questions', 'q1', 'criteria'], msg: `Invalid criteria. ${longPageText} Bearer ${secret} apikey_OTHER data:image/png;base64,AAAA`, input: { state: longPageText } }] }, secret, { state: { text: longPageText } });
    assert.equal(safe.code, 'invalid_question'); assert.equal(safe.param, 'body.questions.q1.criteria');
    assert(!JSON.stringify(safe).includes(secret)); assert(!JSON.stringify(safe).includes(longPageText)); assert(!JSON.stringify(safe).includes('apikey_OTHER')); assert(!JSON.stringify(safe).includes('data:image'));
    assert.match(sanitizeProviderError('Maximum tokens 32768 exceeded').message, /32768/);
    assert.equal(sanitizeProviderError({ detail: { error_type: 'max_tokens_exceeded' } }).code, 'max_tokens_exceeded');
    const echoed = sanitizeProviderError({ message: 'Invalid request: ' + JSON.stringify({ state: { short: 'PRIVATE-SHORT' }, questions: {} }) }, '', { state: { short: 'PRIVATE-SHORT' }, questions: {} });
    assert(!JSON.stringify(echoed).includes('PRIVATE-SHORT'), 'an echoed whole body is removed even when its leaf strings are short');
    console.log('Jev local server: actual loopback HTTP, file/env config, no credential exposure, strict Origin/header/Host/schema, all primitives, bounded bodies/responses/deadlines and upstream status isolation passed');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
