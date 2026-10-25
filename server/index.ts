import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createApp } from './app.ts';
import { createOllama } from './ollama.ts';
import { openStore } from './store.ts';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.ZX_PORT || 4173);
const dev = process.argv.includes('--dev');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('ZX_PORT 需为 1024–65535 的整数。');
if (!dev && !existsSync(join(root, 'dist/index.html'))) {
  console.error('首次启动请先运行：npm run build');
  process.exit(1);
}
const ollama = createOllama(process.env.ZX_OLLAMA_URL);
const store = openStore(join(process.env.ZX_DATA_DIR || join(root, '.data'), 'projects.sqlite'));
const server = createApp({ store, ollama, staticDir: join(root, 'dist'), dev });
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `端口 ${port} 已被占用，请关闭旧进程或设置 ZX_PORT。`
      : '服务启动失败，请检查本地配置。',
  );
  store.close();
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () =>
  console.log(`ZX Ai 已启动 → http://127.0.0.1:${port}\n数据仅保存在本地。按 Ctrl+C 停止。`),
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections();
  server.close(() => store.close());
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
