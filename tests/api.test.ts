import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/app.ts';
import { openStore } from '../server/store.ts';
import { createOllama } from '../server/ollama.ts';
import { EXAMPLE_BRIEF } from '../shared/domain.ts';
import { listen, close, mockOllama } from './helpers.ts';

async function setup() {
  const fake = await mockOllama();
  const store = openStore(':memory:');
  const server = createApp({
    store,
    ollama: createOllama(fake.url),
    staticDir: '/nonexistent-dist',
  });
  const url = await listen(server);
  const request = (
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
    signal?: AbortSignal,
  ) =>
    fetch(url + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  return {
    fake,
    store,
    url,
    request,
    stop: async () => {
      await close(server);
      await fake.close();
      store.close();
    },
  };
}
test('HTTP workflow: create, update, retrieve, export, delete', async () => {
  const app = await setup();
  try {
    assert.equal((await app.request('/api/health')).status, 200);
    const response = await app.request('/api/projects', 'POST', EXAMPLE_BRIEF);
    assert.equal(response.status, 201);
    const p = await response.json();
    assert.equal(p.source, 'ollama');
    assert.ok(p.id);
    const updated = await (
      await app.request(`/api/projects/${p.id}`, 'PATCH', {
        revision: p.revision,
        taskIndex: 1,
        done: true,
      })
    ).json();
    assert.equal(updated.done[1], true);
    assert.equal(
      (await app.request(`/api/projects/${p.id}`, 'PATCH', { revision: 1, notes: 'stale' })).status,
      409,
    );
    assert.equal((await (await app.request('/api/projects')).json()).length, 1);
    const exported = await app.request(`/api/projects/${p.id}/export`);
    assert.ok(exported.headers.get('content-disposition')?.includes('attachment'));
    assert.ok((await exported.text()).includes('Ollama 本地模型'));
    assert.equal(
      (await app.request(`/api/projects/${p.id}`, 'DELETE', { revision: updated.revision })).status,
      200,
    );
    assert.equal((await app.request(`/api/projects/${p.id}`)).status, 404);
    assert.equal((await app.request(`/api/projects/${p.id}/export`)).status, 404);
  } finally {
    await app.stop();
  }
});
test('sample is explicitly marked and does not call a model', async () => {
  const app = await setup();
  try {
    const p = await (await app.request('/api/examples', 'POST', {})).json();
    assert.equal(p.source, 'example');
    assert.equal(app.fake.state.chatCalls, 0);
  } finally {
    await app.stop();
  }
});
test('invalid input and model failures never create projects', async () => {
  const app = await setup();
  try {
    assert.equal(
      (await app.request('/api/projects', 'POST', { ...EXAMPLE_BRIEF, idea: '' })).status,
      400,
    );
    assert.equal(app.fake.state.chatCalls, 0);
    app.fake.state.missing = true;
    assert.equal((await app.request('/api/projects', 'POST', EXAMPLE_BRIEF)).status, 503);
    app.fake.state.missing = false;
    app.fake.state.payload = 'not JSON';
    assert.equal((await app.request('/api/projects', 'POST', EXAMPLE_BRIEF)).status, 502);
    assert.equal(app.store.list().length, 0);
  } finally {
    await app.stop();
  }
});
test('malformed bodies, large bodies, hostile Origin and Host are rejected', async () => {
  const app = await setup();
  try {
    assert.equal(
      (await app.request('/api/examples', 'POST', {}, { Origin: 'https://evil.invalid' })).status,
      403,
    );
    // fetch normalizes Host, so use raw HTTP to exercise DNS-rebinding protection.
    const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        app.url + '/api/projects',
        { headers: { Host: 'evil.invalid' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(hostileHostStatus, 403);
    assert.equal(
      (await app.request('/api/projects', 'GET', undefined, { 'Sec-Fetch-Site': 'cross-site' }))
        .status,
      403,
    );
    assert.equal(
      (await app.request('/api/examples', 'POST', {}, { 'Content-Type': 'text/plain' })).status,
      415,
    );
    assert.equal(
      (
        await fetch(app.url + '/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{',
        })
      ).status,
      400,
    );
    assert.equal(
      (await app.request('/api/projects', 'POST', { idea: 'x'.repeat(40000) })).status,
      413,
    );
    assert.equal(
      (await app.request('/api/projects', 'GET', undefined, { Origin: app.url })).status,
      200,
    );
    assert.equal(app.store.list().length, 0);
  } finally {
    await app.stop();
  }
});
test('cancel disconnect aborts generation, saves nothing, and releases the single-job lock', async () => {
  const app = await setup();
  try {
    app.fake.state.delay = 5000;
    const abort = new AbortController();
    const running = app
      .request('/api/projects', 'POST', EXAMPLE_BRIEF, {}, abort.signal)
      .catch(() => null);
    for (let i = 0; i < 100 && !app.fake.state.chatCalls; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(app.fake.state.chatCalls, 1);
    assert.equal((await app.request('/api/projects', 'POST', EXAMPLE_BRIEF)).status, 409);
    abort.abort();
    await running;
    app.fake.state.delay = 0;
    let retry: Response | undefined;
    for (let i = 0; i < 100; i++) {
      retry = await app.request('/api/projects', 'POST', EXAMPLE_BRIEF);
      if (retry.status !== 409) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(retry?.status, 201);
    assert.equal(app.store.list().length, 1);
  } finally {
    await app.stop();
  }
});
