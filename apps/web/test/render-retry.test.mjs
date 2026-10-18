// The studio's side of the API's busy contract: a render worker that is already rendering answers
// 503 with Retry-After (apps/api/api_v1.py, RETRY_AFTER_S), the rate limiter 429 with Retry-After.
// Two quick parameter changes, or two visitors at once, used to surface that 503 as "the API could
// not regenerate the document". The studio now waits and retries (bounded), and only the latest
// regeneration may replace the document on screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postRender, retryAfterSeconds, latestOnly, regenerate, exportFile, BUSY_RETRIES, MAX_RETRY_AFTER_S } from '../studio/src/data.js';

function reply(status, body, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
function scripted(replies) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return replies.shift(); };
  return { calls, fetchImpl };
}
const busy = () => reply(503, { error: 'this worker is already rendering; retry shortly', status: 503, retry_after: 1 }, { 'Retry-After': '1' });

test('Retry-After is read as bounded whole seconds; anything else means do not retry', () => {
  assert.equal(retryAfterSeconds('1'), 1);
  assert.equal(retryAfterSeconds(' 2 '), 2);
  assert.equal(retryAfterSeconds('0'), 0);
  assert.equal(retryAfterSeconds(String(MAX_RETRY_AFTER_S)), MAX_RETRY_AFTER_S);
  assert.equal(retryAfterSeconds(String(MAX_RETRY_AFTER_S + 1)), null);   // a long rate-limit wait is shown, not hidden
  for (const raw of [null, '', 'soon', '-1', '1.5', 'Wed, 21 Oct 2026 07:28:00 GMT']) assert.equal(retryAfterSeconds(raw), null, String(raw));
});

test('a busy 503 is retried after Retry-After and the document arrives', async () => {
  const { calls, fetchImpl } = scripted([busy(), reply(200, { file_spec: 1.2 })]);
  const waits = [];
  const doc = await regenerate('valley-fold', { size: 155 }, 'default', { fetchImpl, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(doc, { file_spec: 1.2 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(calls[0].url, '/api/v1/documents');
  assert.deepEqual(waits, [1000]);
});

test('a 429 with a short Retry-After is retried; waits grow with each attempt', async () => {
  const limited = () => reply(429, { error: 'rate limit exceeded', status: 429 }, { 'Retry-After': '1' });
  const { calls, fetchImpl } = scripted([limited(), busy(), reply(200, 'svg-bytes', { 'Content-Type': 'image/svg+xml' })]);
  const waits = [];
  const blob = await exportFile('valley-fold', {}, 'svg', null, { fetchImpl, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(await blob.text(), 'svg-bytes');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, '/api/v1/exports');
  assert.deepEqual(waits, [1000, 2000]);
});

test('retries are bounded: a worker that stays busy surfaces the 503', async () => {
  const { calls, fetchImpl } = scripted(Array.from({ length: BUSY_RETRIES + 1 }, busy));
  await assert.rejects(regenerate('valley-fold', {}, null, { fetchImpl, sleep: async () => {} }), /503/);
  assert.equal(calls.length, BUSY_RETRIES + 1);
});

test('errors that are not busy are not retried', async () => {
  for (const r of [reply(400, { error: 'bad' }), reply(503, { error: 'no header' }), reply(429, { error: 'long' }, { 'Retry-After': '60' }), reply(500, { error: 'x' })]) {
    const { calls, fetchImpl } = scripted([r]);
    const res = await postRender('/api/v1/documents', '{}', { fetchImpl, sleep: async () => { throw new Error('must not wait'); } });
    assert.equal(res.status, r.status);
    assert.equal(calls.length, 1);
  }
});

test('only the latest regeneration may land', () => {
  const gate = latestOnly();
  const first = gate.begin();
  const second = gate.begin();
  assert.equal(first(), false);   // an older response that arrives late is dropped
  assert.equal(second(), true);
  const third = gate.begin();
  assert.equal(second(), false);
  assert.equal(third(), true);
});
