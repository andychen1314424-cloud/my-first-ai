import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { EXAMPLE_PLAN } from '../shared/domain.ts';

export async function listen(server: Server, port = 0) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listening address');
  return `http://127.0.0.1:${address.port}`;
}
export async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

// Protocol fixture, not a model. Test-only; never imported by production code.
export async function mockOllama() {
  const state = {
    delay: 0,
    missing: false,
    remote: false,
    badJSON: false,
    httpStatus: 200,
    payload: JSON.stringify(EXAMPLE_PLAN),
    done: true,
    doneReason: 'stop',
    chatCalls: 0,
    requests: [] as Record<string, unknown>[],
  };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const data = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    let result: unknown;
    if (req.url === '/api/tags') result = { models: state.missing ? [] : [{ name: 'qwen3:1.7b' }] };
    else if (req.url === '/api/show')
      result = state.remote
        ? { remote_host: 'https://example.invalid', remote_model: 'cloud' }
        : { details: { family: 'qwen3' } };
    else if (req.url === '/api/chat') {
      state.chatCalls++;
      state.requests.push(data);
      if (state.delay)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, state.delay);
          res.once('close', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      result = {
        message: { content: state.payload },
        done: state.done,
        done_reason: state.doneReason,
      };
    } else {
      res.writeHead(404);
      res.end();
      return;
    }
    if (res.destroyed) return;
    res.writeHead(req.url === '/api/chat' ? state.httpStatus : 200, {
      'Content-Type': 'application/json',
    });
    res.end(state.badJSON ? 'not json' : JSON.stringify(result));
  });
  const url = await listen(server);
  return { state, server, url, close: () => close(server) };
}
