import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/app.ts';
import { createOllama } from '../server/ollama.ts';
import { createAiProvider } from '../server/ai-provider.ts';
import { openChatStore, validateChatInput } from '../server/chat-store.ts';
import { withDownloadStatus } from '../server/model-download-status.ts';
import { openStore } from '../server/store.ts';
import { CHAT_MODELS } from '../shared/chat.ts';
import type { ChatEvent, Conversation } from '../shared/chat.ts';
import { listen, close } from './helpers.ts';
import { mockChatOllama } from './chat-fixture.ts';

async function setup(t: TestContext) {
  const fake = await mockChatOllama();
  const chat = openChatStore(':memory:');
  const store = openStore(':memory:');
  const ai = createAiProvider(fake.url, 3000);
  const app = createApp({ store, chat, ai, ollama: createOllama(fake.url), staticDir: '/nonexistent' });
  const url = await listen(app);
  t.after(async () => { await close(app); await fake.close(); chat.close(); store.close(); });
  const request = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(url + path, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const create = async (): Promise<Conversation> => {
    const r = await request('/api/chat/conversations', 'POST', {});
    assert.equal(r.status, 201); return r.json();
  };
  return { fake, chat, ai, url, request, create };
}
const input = (text = '合成聊天测试') => ({ text, modelId: 'qwen3:4b', requestId: randomUUID() });
async function events(r: Response): Promise<ChatEvent[]> {
  assert.equal(r.status, 200, await (r.status === 200 ? Promise.resolve('') : r.text()));
  assert.match(r.headers.get('content-type') ?? '', /ndjson/);
  return (await r.text()).trim().split('\n').filter(Boolean).map((s) => JSON.parse(s));
}

test('local catalog exposes Qwen, DeepSeek and genuine Kimi with no cloud model', async (t) => {
  const app = await setup(t);
  const r = await app.request('/api/ai/status');
  const status = await r.json();
  assert.equal(status.cloudEnabled, false);
  assert.equal(status.connected, true);
  assert.deepEqual(new Set(status.models.map((m: { family: string }) => m.family)), new Set(['Qwen', 'DeepSeek', 'Kimi']));
  assert.equal(status.models.find((m: { id: string }) => m.id === 'deepseek-r1:1.5b').available, true);
  assert.equal(status.models.find((m: { family: string }) => m.family === 'Kimi').available, false);
  assert.ok(CHAT_MODELS.every((m) => !m.id.endsWith(':cloud')));
  assert.throws(() => createAiProvider('https://api.deepseek.com'));
  assert.throws(() => createAiProvider('http://localhost:11434'));
  assert.throws(() => createAiProvider('http://127.0.0.1:11434/remote'));
});

test('chat HTTP streams UTF8 final text, persists history, replays safely and sends bounded conversation context', async (t) => {
  const app = await setup(t), c = await app.create(), body = input();
  const path = `/api/chat/conversations/${c.id}/messages`;
  const stream = await events(await app.request(path, 'POST', body));
  assert.equal(stream[0].type, 'start');
  assert.equal(stream.filter((e) => e.type === 'delta').map((e) => e.type === 'delta' ? e.text : '').join(''), '本地协议夹具：这是一条合成回答。');
  assert.equal(stream.at(-1)?.type, 'done');
  assert.doesNotMatch(JSON.stringify(stream), /internal reasoning/);
  let saved = await (await app.request(`/api/chat/conversations/${c.id}`)).json();
  assert.equal(saved.messages.length, 2);
  assert.equal(saved.messages[1].status, 'complete');
  assert.equal(saved.messages[0].text, body.text);
  assert.equal(app.fake.state.requests[0].think, true);
  const originalPayload = app.fake.state.requests[0].messages as { role: string; content: string }[];
  assert.match(originalPayload.at(-1)!.content, /\/no_think$/);
  await events(await app.request(path, 'POST', body));
  assert.equal(app.fake.state.calls, 1);
  assert.equal((await app.request(path, 'POST', { ...body, text: '异内容复用键' })).status, 409);
  await events(await app.request(path, 'POST', input('第二条合成消息')));
  const messages = app.fake.state.requests.at(-1)?.messages as { role: string; content: string }[];
  assert.equal(messages.filter((m) => m.role === 'user').length, 2);
  assert.equal(messages.filter((m) => m.role === 'assistant').length, 1);
  assert.equal(app.fake.state.requests[0].stream, true);
  saved = await (await app.request(`/api/chat/conversations/${c.id}`)).json();
  assert.equal(saved.messages.length, 4);
  const list = await (await app.request('/api/chat/conversations')).json();
  assert.equal(list[0].id, c.id);
  assert.equal((await app.request(`/api/chat/conversations/${c.id}`, 'PATCH', { title: '合成重命名' })).status, 200);
  assert.equal((await app.request(`/api/chat/conversations/${c.id}`, 'DELETE')).status, 204);
  assert.equal((await app.request(`/api/chat/conversations/${c.id}`)).status, 404);
  const next = await app.create();
  assert.equal((await app.request(`/api/chat/conversations/${next.id}/messages`, 'POST', body)).status, 410);
});

test('missing, cloud and remote Ollama models never reach inference or insert messages', async (t) => {
  const app = await setup(t), c = await app.create();
  const path = `/api/chat/conversations/${c.id}/messages`;
  const cloud = await app.request(path, 'POST', { ...input(), modelId: 'kimi-k2:cloud' });
  assert.equal(cloud.status, 400);
  const missing = await app.request(path, 'POST', { ...input(), modelId: 'deepseek-r1:8b' });
  assert.equal(missing.status, 503);
  app.fake.state.remote = true;
  assert.equal((await app.request(path, 'POST', input())).status, 503);
  assert.equal(app.fake.state.calls, 0);
  assert.equal(app.chat.get(c.id).messages.length, 0);
});

test('Kimi uses its own local CPU mapped weights and preserves the question without changing other models', async (t) => {
  const app = await setup(t), c = await app.create();
  const modelId = CHAT_MODELS.find((model) => model.family === 'Kimi')!.id;
  app.fake.state.models.push(modelId);
  const body = { ...input('合成 CPU 映射验证'), modelId };
  const result = await events(await app.request(`/api/chat/conversations/${c.id}/messages`, 'POST', body));
  assert.equal(result.at(-1)?.type, 'done');
  const payload = app.fake.state.requests[0];
  assert.equal(payload.model, modelId);
  assert.equal(payload.think, false);
  assert.deepEqual(payload.options, { temperature: 0.5, num_ctx: 16384, num_predict: 2048, num_gpu: 0, use_mmap: true });
  assert.equal((payload.messages as { content: string }[]).at(-1)!.content, body.text);
  assert.equal(app.chat.get(c.id).messages[0].text, body.text);
  assert.equal(app.chat.get(c.id).messages[1].modelId, modelId);
  await events(await app.request(`/api/chat/conversations/${c.id}/messages`, 'POST', input()));
  const qwenOptions = app.fake.state.requests[1].options as Record<string, unknown>;
  assert.equal(qwenOptions.num_gpu, undefined);
  assert.equal(qwenOptions.use_mmap, undefined);
});

test('bad JSON, unfinished replies and output limits remain visible failures instead of fake completed answers', async (t) => {
  const app = await setup(t);
  for (const mode of ['badJSON', 'unfinished', 'length', 'upstreamError'] as const) {
    app.fake.state[mode] = true;
    const c = await app.create();
    const result = await events(await app.request(`/api/chat/conversations/${c.id}/messages`, 'POST', input(mode)));
    assert.equal(result.at(-1)?.type, 'error', mode);
    const saved = app.chat.get(c.id).messages.at(-1)!;
    assert.equal(saved.status, 'error', mode);
    assert.ok(saved.error);
    assert.doesNotMatch(JSON.stringify(result), /private upstream data/);
    app.fake.state[mode] = false;
  }
});

test('disconnect cancels inference, retains partial text and prevents concurrent duplicate generation', async (t) => {
  const app = await setup(t), c = await app.create();
  app.fake.state.delay = 120;
  const path = `/api/chat/conversations/${c.id}/messages`;
  const response = await app.request(path, 'POST', input());
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  let received = '';
  while (!received.includes('"delta"')) { const part = await reader.read(); assert.equal(part.done, false); received += new TextDecoder().decode(part.value); }
  assert.equal((await app.request(path, 'POST', input('并发合成请求'))).status, 409);
  await reader.cancel();
  for (let n = 0; n < 80 && !app.chat.get(c.id).messages.at(-1)?.status; n++) await new Promise((r) => setTimeout(r, 10));
  const saved = app.chat.get(c.id).messages.at(-1)!;
  assert.equal(saved.status, 'stopped');
  assert.ok(saved.text.includes('本地协议夹具'));
  assert.equal(app.fake.state.calls, 1);
});

test('chat keeps Host, Origin and strict input boundaries before contacting any model', async (t) => {
  const app = await setup(t), c = await app.create();
  const path = `/api/chat/conversations/${c.id}/messages`;
  assert.equal((await app.request(path, 'POST', input(), { Origin: 'https://example.invalid' })).status, 403);
  const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(app.url + '/api/ai/status', { headers: { host: 'evil.invalid' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(hostStatus, 403);
  assert.equal((await app.request(path, 'POST', { ...input(), apiKey: 'synthetic-not-a-key' })).status, 400);
  assert.equal((await app.request(path, 'POST', input('x'.repeat(6001)))).status, 400);
  assert.equal(app.fake.state.calls, 0);
  assert.throws(() => validateChatInput({ ...input(), requestId: '../unsafe' }));
});

test('SQLite chat survives reopening, recovers interrupted exchanges and retains idempotency tombstones', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'zx-chat-durable-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'chat.sqlite');
  let store = openChatStore(filename);
  const c = store.create({}), first = input();
  store.begin(c.id, first); store.finish(first.requestId, '合成已完成', 'complete');
  const pending = input('合成中断'); store.begin(c.id, pending);
  store.close(); store = openChatStore(filename);
  assert.equal(store.get(c.id).messages[1].text, '合成已完成');
  assert.equal(store.get(c.id).messages.at(-1)?.status, 'stopped');
  assert.equal(store.lookup(c.id, first)?.assistant.text, '合成已完成');
  store.remove(c.id);
  assert.throws(() => store.lookup(c.id, first), /删除/);
  store.close();
});

test('optional download telemetry validates identity, size and freshness without treating a download as installed', async (t) => {
  const app = await setup(t);
  const directory = mkdtempSync(join(tmpdir(), 'zx-model-progress-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'deepseek-r1-8b.json');
  const record = { model: 'deepseek-r1:8b', completed: 1024, total: 8192, finished: false, updatedAt: new Date().toISOString() };
  const ai = withDownloadStatus(app.ai, directory);
  writeFileSync(file, JSON.stringify(record));
  let model = (await ai.status()).models.find((m) => m.id === record.model)!;
  assert.equal(model.download?.completed, 1024);
  assert.equal(model.available, false); assert.equal(model.installed, false);
  writeFileSync(file, JSON.stringify({ ...record, updatedAt: '2020-01-01T00:00:00Z' }));
  model = (await ai.status()).models.find((m) => m.id === record.model)!;
  assert.equal(model.download, undefined);
  writeFileSync(file, JSON.stringify({ ...record, completed: 99999 }));
  assert.equal((await ai.status()).models.find((m) => m.id === record.model)!.download, undefined);
});
