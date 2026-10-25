import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { AppError, EXAMPLE_BRIEF, EXAMPLE_PLAN, validateBrief } from '../shared/domain.ts';
import type { Store } from './store.ts';
import type { createOllama } from './ollama.ts';
import { toMarkdown } from './export.ts';

type Options = {
  store: Store;
  ollama: ReturnType<typeof createOllama>;
  staticDir: string;
  dev?: boolean;
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

export function createApp({ store, ollama, staticDir, dev = false }: Options) {
  let generating = false;
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
        return json(res, 200, { ok: true, mode: 'local-only', version: '0.1.0' });
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
