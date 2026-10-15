import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler } from '../server/server.js';
import { createRelay, issueSpeechToken } from '../server/relay.js';

async function withServer(opts, fn) {
  const server = http.createServer(createHandler({ client: {}, token: 'secret', log: {}, ...opts }));
  await new Promise((r) => server.listen(0, r));
  try { await fn(`http://localhost:${server.address().port}`); } finally { server.closeAllConnections(); server.close(); }
}
const auth = { Authorization: 'Bearer secret' };

test('ghép trang micro và chuyển chữ tới add-in qua SSE', async () => {
  await withServer({}, async (url) => {
    assert.equal((await fetch(`${url}/api/pair`, { method: 'POST' })).status, 401);
    const { pair, key } = await (await fetch(`${url}/api/pair`, { method: 'POST', headers: auth })).json();
    assert.ok(pair && key);

    const say = (body, k = key) => fetch(`${url}/api/pair/${pair}/say`, { method: 'POST', headers: { 'X-Pair-Key': k, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await say({ text: 'x', final: true }, 'sai-ma')).status, 401);
    assert.equal((await (await say({ text: 'chưa ai nghe', final: true })).json()).delivered, 0);

    const ctrl = new AbortController();
    const res = await fetch(`${url}/api/pair/${pair}/events`, { headers: auth, signal: ctrl.signal });
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    await reader.read(); // ": ok"

    assert.equal((await (await say({ text: 'In đậm câu vừa rồi.', final: true })).json()).delivered, 1);
    const { value } = await reader.read();
    assert.deepEqual(JSON.parse(value.trim().slice(6)), { type: 'text', text: 'In đậm câu vừa rồi.', final: true, on: false });
    ctrl.abort();
  });
});

test('luồng sự kiện cần mã truy cập và phiên còn hạn', async () => {
  await withServer({}, async (url) => {
    assert.equal((await fetch(`${url}/api/pair/abcdef/events`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${url}/api/pair/abcdef/events`)).status, 401);
  });
});

test('phiên ghép hết hạn sau 12 giờ', () => {
  let t = 0;
  const relay = createRelay({ now: () => t });
  const { pair, key } = relay.create();
  assert.ok(relay.checkKey(pair, key));
  t += 13 * 3600 * 1000;
  assert.equal(relay.checkKey(pair, key), false);
  assert.equal(relay.exists(pair), false);
});

test('mã Azure Speech: chưa cấu hình → 501; có cấu hình → trả token', async () => {
  await withServer({}, async (url) => {
    assert.equal((await fetch(`${url}/api/speech-token`, { headers: auth })).status, 501);
    assert.equal((await fetch(`${url}/api/speech-token`)).status, 401);
  });
  await withServer({ speechToken: async () => ({ token: 'tok', region: 'southeastasia' }) }, async (url) => {
    const { pair, key } = await (await fetch(`${url}/api/pair`, { method: 'POST', headers: auth })).json();
    const res = await fetch(`${url}/api/speech-token`, { headers: { 'X-Pair-Id': pair, 'X-Pair-Key': key } });
    assert.deepEqual(await res.json(), { token: 'tok', region: 'southeastasia' });
    assert.equal((await (await fetch(`${url}/health`)).json()).speech, true);
  });
});

test('issueSpeechToken gọi đúng endpoint Azure', async () => {
  let called;
  const r = await issueSpeechToken({ key: 'k', region: 'southeastasia', fetchImpl: async (u, o) => { called = [u, o.headers['Ocp-Apim-Subscription-Key']]; return { ok: true, text: async () => 'jwt' }; } });
  assert.deepEqual(called, ['https://southeastasia.api.cognitive.microsoft.com/sts/v1.0/issueToken', 'k']);
  assert.deepEqual(r, { token: 'jwt', region: 'southeastasia' });
  assert.equal(await issueSpeechToken({ key: '', region: '' }), null);
});
