import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../server/app.ts';
import { createOllama } from '../server/ollama.ts';
import { openStore } from '../server/store.ts';
import { mockOllama, listen, close } from './helpers.ts';

const dir = mkdtempSync(join(tmpdir(), 'zx-e2e-'));
const fake = await mockOllama();
const store = openStore(join(dir, 'projects.sqlite'));
const app = createApp({
  store,
  ollama: createOllama(fake.url),
  staticDir: resolve(import.meta.dirname, '../dist'),
});
await listen(app, 4174);
console.log('Browser test server is using a protocol fixture, not a real model.');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await close(app);
  await fake.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
