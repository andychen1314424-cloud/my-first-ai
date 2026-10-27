import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { AppError, EXAMPLE_BRIEF, EXAMPLE_PLAN, validateBrief } from '../shared/domain.ts';
import type { Store } from './store.ts';
import type { createOllama } from './ollama.ts';
import { toMarkdown } from './export.ts';
import type { FinanceStore } from './finance.ts';
import { validateChatInput } from './chat-store.ts';
import type { ChatStore } from './chat-store.ts';
import type { AIProvider } from './ai-provider.ts';
import type { ChatEvent } from '../shared/chat.ts';

type Options = {
  store: Store;
  ollama: ReturnType<typeof createOllama>;
  staticDir: string;
  dev?: boolean;
  finance?: FinanceStore;
  chat?: ChatStore;
  ai?: AIProvider;
};
function json(res: ServerResponse, code: number, data: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))
    throw new AppError('请求需使用 application/json。', 415);
  const raw = await new Promise<string>((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 32768) {
        chunks.length = 0;
        reject(new AppError('输入过长，最多 32 KB。', 413));
      } else chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => reject(new AppError('读取输入失败。')));
    req.on('aborted', () => reject(new AppError('请求已取消。', 499)));
  });
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError('输入不是合法 JSON。');
  }
}

export function createApp({ store, ollama, staticDir, dev = false, finance, chat, ai }: Options) {
  let generating = false;
  let chatting = false;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const hosts = [`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`];
      if (!hosts.includes(req.headers.host || '')) throw new AppError('仅允许本机访问。', 403);
      const origins = hosts.map((host) => `http://${host}`);
      if (dev) origins.push('http://127.0.0.1:5173', 'http://localhost:5173');
      if (
        (req.headers.origin && !origins.includes(req.headers.origin)) ||
        req.headers['sec-fetch-site'] === 'cross-site'
      ) {
        throw new AppError('不允许其他网站访问本地项目。', 403);
      }
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const method = req.method || 'GET';
      const path = url.pathname;
      if (path === '/api/health' && method === 'GET')
        return json(res, 200, { ok: true, mode: 'local-only', version: '2.0.0-integration.1' });
      if (path === '/api/ai/status' && method === 'GET') {
        if (!ai) throw new AppError('本地聊天模型服务尚未启用。', 503);
        return json(res, 200, await ai.status());
      }
      if (path.startsWith('/api/chat/')) {
        if (!chat || !ai) throw new AppError('本地聊天服务尚未启用。', 503);
        if (path === '/api/chat/conversations' && method === 'GET') return json(res, 200, chat.list());
        if (path === '/api/chat/conversations' && method === 'POST') return json(res, 201, chat.create(await readJson(req)));
        const conversation = /^\/api\/chat\/conversations\/([^/]+)(\/messages)?$/.exec(path);
        if (conversation) {
          const id = decodeURIComponent(conversation[1]);
          const messages = !!conversation[2];
          if (!messages && method === 'GET') return json(res, 200, chat.get(id));
          if (!messages && method === 'PATCH') return json(res, 200, chat.rename(id, await readJson(req)));
          if (!messages && method === 'DELETE') {
            chat.remove(id); res.writeHead(204); res.end(); return;
          }
          if (messages && method === 'POST') {
            const input = validateChatInput(await readJson(req));
            const replay = chat.lookup(id, input);
            const event = (value: ChatEvent) => {
              if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(value) + '\n');
            };
            const streamHeaders = () => {
              res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
              res.flushHeaders();
            };
            if (replay) {
              streamHeaders(); event({ type: 'start', ...replay });
              if (replay.assistant.status === 'complete') event({ type: 'done', message: replay.assistant });
              else event({ type: 'error', error: replay.assistant.error || '上次生成未完成，可重新提问。', message: replay.assistant });
              res.end(); return;
            }
            if (chatting) throw new AppError('已有一条消息正在生成，请先停止或等待完成。', 409);
            chatting = true;
            const abort = new AbortController();
            const onClose = () => { if (!res.writableEnded) abort.abort(); };
            res.once('close', onClose);
            let begun = false;
            let text = '';
            let checkpoint = Date.now();
            try {
              await ai.assertModel(input.modelId, abort.signal);
              abort.signal.throwIfAborted();
              const exchange = chat.begin(id, input);
              begun = true;
              const context = chat.context(id, exchange.user);
              streamHeaders(); event({ type: 'start', ...exchange });
              try {
                await ai.stream(input.modelId, context, abort.signal, (delta) => {
                  text += delta;
                  if (text.length > 65536) throw new AppError('模型回复超出保存上限。', 502);
                  if (Date.now() - checkpoint >= 500) {
                    chat.checkpoint(input.requestId, text); checkpoint = Date.now();
                  }
                  event({ type: 'delta', text: delta });
                });
                abort.signal.throwIfAborted();
                const message = chat.finish(input.requestId, text, 'complete');
                begun = false;
                event({ type: 'done', message });
              } catch (error) {
                const stopped = abort.signal.aborted || (error instanceof AppError && error.status === 499);
                const reason = stopped ? '生成已停止，已保留已收到的回复。' : error instanceof AppError ? error.message : '本地生成失败，已保留已收到的回复。';
                const message = chat.finish(input.requestId, text.slice(0, 65536), stopped ? 'stopped' : 'error', reason);
                begun = false;
                event({ type: 'error', error: reason, message });
              }
              if (!res.destroyed && !res.writableEnded) res.end();
              return;
            } finally {
              if (begun) {
                try { chat.finish(input.requestId, text.slice(0, 65536), 'error', '生成中断，已保留已收到的回复。'); } catch { /* Startup recovery handles any remaining pending row. */ }
              }
              chatting = false;
              res.off('close', onClose);
            }
          }
        }
        throw new AppError('聊天接口不存在。', 404);
      }
      if (path.startsWith('/api/finance/')) {
        if (!finance) throw new AppError('财务存储尚未启用。', 503);
        if (path === '/api/finance/snapshot' && method === 'GET')
          return json(res, 200, finance.snapshot(url.searchParams.get('month') ?? undefined));
        if (path === '/api/finance/accounts' && method === 'POST')
          return json(res, 201, finance.createAccount(await readJson(req)));
        if (path === '/api/finance/transactions' && method === 'POST')
          return json(res, 201, finance.createTransaction(await readJson(req), req.headers['idempotency-key']));
        const transaction = /^\/api\/finance\/transactions\/([^/]+)$/.exec(path);
        if (transaction && method === 'PUT')
          return json(res, 200, finance.updateTransaction(decodeURIComponent(transaction[1]), await readJson(req)));
        if (transaction && method === 'DELETE') {
          finance.deleteTransaction(decodeURIComponent(transaction[1]));
          res.writeHead(204);
          res.end();
          return;
        }
        const budget = /^\/api\/finance\/budget\/([^/]+)$/.exec(path);
        if (budget && method === 'PUT')
          return json(res, 200, finance.setBudget(decodeURIComponent(budget[1]), await readJson(req)));
        const repayment = /^\/api\/finance\/liabilities\/([^/]+)\/repayments$/.exec(path);
        if (repayment && method === 'POST') {
          finance.repayLiability(decodeURIComponent(repayment[1]), await readJson(req), req.headers['idempotency-key']);
          res.writeHead(204);
          res.end();
          return;
        }
        throw new AppError('财务接口不存在。', 404);
      }
      if (path === '/api/models' && method === 'GET') return json(res, 200, await ollama.status());
      if (path === '/api/projects' && method === 'GET') return json(res, 200, store.list());
      if (path === '/api/examples' && method === 'POST') {
        await readJson(req);
        return json(res, 201, store.create(EXAMPLE_BRIEF, EXAMPLE_PLAN, 'example'));
      }
      if (path === '/api/projects' && method === 'POST') {
        const brief = validateBrief(await readJson(req));
        if (generating) throw new AppError('已有一个项目正在生成，请稍后重试。', 409);
        generating = true;
        const abort = new AbortController();
        const onClose = () => {
          if (!res.writableEnded) abort.abort();
        };
        res.once('close', onClose);
        const started = Date.now();
        try {
          const plan = await ollama.generate(brief, abort.signal);
          abort.signal.throwIfAborted();
          return json(res, 201, store.create(brief, plan, 'ollama', Date.now() - started));
        } finally {
          generating = false;
          res.off('close', onClose);
        }
      }
      const match = /^\/api\/projects\/([a-f0-9-]{36})(\/export)?$/.exec(path);
      if (match) {
        const [, id, exporting] = match;
        if (exporting && method === 'GET') {
          const markdown = toMarkdown(store.get(id));
          res.writeHead(200, {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="zx-project-${id}.md"`,
          });
          res.end(markdown);
          return;
        }
        if (!exporting && method === 'GET') return json(res, 200, store.get(id));
        if (!exporting && method === 'PATCH')
          return json(res, 200, store.update(id, await readJson(req)));
        if (!exporting && method === 'DELETE') {
          const body = (await readJson(req)) as { revision?: number } | null;
          if (!Number.isInteger(body?.revision)) throw new AppError('缺少项目版本。');
          store.remove(id, body!.revision!);
          return json(res, 200, { ok: true });
        }
      }
      if (path.startsWith('/api/')) throw new AppError('接口不存在。', 404);
      if (method !== 'GET' && method !== 'HEAD') throw new AppError('不支持此操作。', 405);
      const file = resolve(
        staticDir,
        '.' + decodeURIComponent(path === '/' ? '/index.html' : path),
      );
      if (!file.startsWith(resolve(staticDir) + sep)) throw new AppError('文件不存在。', 404);
      try {
        const body = await readFile(file);
        const types: Record<string, string> = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.map': 'application/json',
          '.webmanifest': 'application/manifest+json',
        };
        res.writeHead(200, {
          'Content-Type': `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8`,
        });
        res.end(method === 'HEAD' ? undefined : body);
      } catch {
        throw new AppError('页面文件不存在。首次启动前请运行 npm run build。', 404);
      }
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) { res.end(); return; }
      const status =
        error instanceof AppError ? error.status : error instanceof URIError ? 400 : 500;
      json(res, status, {
        error:
          error instanceof AppError ? error.message : '服务处理失败，请检查本地启动环境后重试。',
      });
    }
  });
  server.requestTimeout = 30000;
  return server;
}
