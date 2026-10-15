import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler } from '../server/server.js';
import { TOOLS } from '../server/tools.js';
import { Anthropic } from '../server/claude.js';

function fakeClient(response, seen = []) {
  const create = async (params) => {
    seen.push(params);
    if (response instanceof Error) throw response;
    return response;
  };
  return { messages: { create }, beta: { messages: { create } } };
}

async function withServer(client, fn) {
  const server = http.createServer(createHandler({ client, token: 'secret', log: {} }));
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  try { await fn(url); } finally { server.close(); }
}

const post = (url, body, token = 'secret') => fetch(`${url}/api/command`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: 'https://dttung1.github.io' },
  body: JSON.stringify(body),
});

test('mọi công cụ có schema strict hợp lệ', () => {
  for (const t of TOOLS) {
    assert.equal(t.strict, true);
    assert.equal(t.input_schema.additionalProperties, false);
    for (const r of t.input_schema.required) assert.ok(t.input_schema.properties[r], `${t.name}.${r}`);
  }
});

test('chuyển lệnh cho Claude và trả về thao tác', async () => {
  const seen = [];
  const client = fakeClient({
    model: 'claude-opus-5-5',
    stop_reason: 'tool_use',
    usage: { input_tokens: 2100, output_tokens: 90 },
    content: [
      { type: 'text', text: 'Đã chuyển 2 đoạn thành danh sách.' },
      { type: 'tool_use', id: 't1', name: 'set_paragraph', input: { target: { type: 'paragraph_range', paragraph_start: 2, paragraph_end: 3 }, style: 'list_number' } },
      { type: 'tool_use', id: 't2', name: 'not_a_tool', input: {} },
    ],
  }, seen);
  await withServer(client, async (url) => {
    const res = await post(url, { utterance: 'đánh số các đoạn về ngân sách', context: { selection: '', outline: [{ i: 2, text: 'Ngân sách…' }] } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://dttung1.github.io');
    const body = await res.json();
    assert.equal(body.ops.length, 1, 'bỏ công cụ lạ');
    assert.equal(body.ops[0].name, 'set_paragraph');
    assert.match(body.message, /danh sách/);
  });
  const p = seen[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(p.output_config.effort, 'low');
  assert.equal(p.tool_choice, undefined, 'không ép dùng công cụ');
  assert.match(p.messages[0].content, /đánh số các đoạn về ngân sách/);
});

test('từ chối khi sai mã truy cập, thiếu câu lệnh', async () => {
  await withServer(fakeClient({}), async (url) => {
    assert.equal((await post(url, { utterance: 'x' }, 'wrong')).status, 401);
    assert.equal((await post(url, { utterance: '  ' })).status, 400);
  });
});

test('Claude từ chối → trả thông báo, không có thao tác', async () => {
  const client = fakeClient({ model: 'm', stop_reason: 'refusal', usage: {}, content: [] });
  await withServer(client, async (url) => {
    const body = await (await post(url, { utterance: 'abc' })).json();
    assert.deepEqual(body.ops, []);
    assert.ok(body.message);
  });
});

test('lỗi API được đổi thành thông báo dễ hiểu', async () => {
  const err = new Anthropic.APIError(503, { type: 'error' }, 'overloaded', new Headers());
  await withServer(fakeClient(err), async (url) => {
    const res = await post(url, { utterance: 'abc' });
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /AI/);
  });
});
