import { createServer } from 'node:http';
import { listen, close } from './helpers.ts';

/** Explicit protocol fixture; it is not an AI model and is never used in production. */
export async function mockChatOllama() {
  const state = {
    models: ['qwen3:4b', 'deepseek-r1:1.5b'],
    remote: false,
    missing: false,
    delay: 10,
    calls: 0,
    badJSON: false,
    unfinished: false,
    length: false,
    upstreamError: false,
    chunks: ['本地协议夹具：', '这是一条合成回答。'],
    requests: [] as Record<string, unknown>[],
  };
  const server = createServer(async (req, res) => {
    const input: Buffer[] = [];
    for await (const part of req) input.push(part);
    const body = input.length ? JSON.parse(Buffer.concat(input).toString()) : {};
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') {
      res.end(JSON.stringify({ models: state.missing ? [] : state.models.map((name) => ({ name, size: 123456, ...(state.remote ? { remote_host: 'https://example.invalid' } : {}) })) }));
      return;
    }
    if (req.url === '/api/show') {
      res.end(JSON.stringify(state.remote ? { remote_model: 'external', remote_host: 'https://example.invalid' } : { details: { family: 'qwen3' } }));
      return;
    }
    if (req.url !== '/api/chat') {
      res.writeHead(404); res.end(); return;
    }
    state.calls++;
    state.requests.push(body);
    const lastQuestion = Array.isArray(body.messages) ? String(body.messages.at(-1)?.content ?? '') : '';
    const slow = lastQuestion.includes('[慢速]');
    if (state.upstreamError || lastQuestion.includes('[错误]')) { res.writeHead(500); res.end('private upstream data must not leak'); return; }
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write(JSON.stringify({ message: { role: 'assistant', thinking: 'fixture internal reasoning is not final answer', content: '' }, done: false }) + '\n');
    if (state.badJSON) { res.end('invalid json\n'); return; }
    for (const text of slow ? ['本地协议夹具：', ...Array.from({ length: 8 }, () => '合成慢速片段。')] : [...state.chunks]) {
      await new Promise<void>((done) => { const timer = setTimeout(done, slow ? 180 : state.delay); res.once('close', () => { clearTimeout(timer); done(); }); });
      if (res.destroyed) return;
      // Split in the middle of Chinese UTF-8 to exercise incremental decoding.
      const line = Buffer.from(JSON.stringify({ message: { role: 'assistant', content: text }, done: false }) + '\n');
      const mid = Math.floor(line.length / 2);
      res.write(line.subarray(0, mid)); res.write(line.subarray(mid));
    }
    if (!state.unfinished) res.write(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: state.length ? 'length' : 'stop' }) + '\n');
    res.end();
  });
  const url = await listen(server);
  return { state, url, server, close: () => close(server) };
}
