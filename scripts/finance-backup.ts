import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { backupFinance, rollbackEmptyFinance } from '../server/finance-migrations.ts';

const root = resolve(import.meta.dirname, '..');
const data = resolve(process.env.ZX_DATA_DIR || join(root,'.data'));
const filename = join(data,'finance.sqlite');
const stamp = new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const target = join(data,'backups',`finance-${stamp}.sqlite`);
const rollback = process.argv.includes('--rollback-empty');
if (process.argv.slice(2).some((arg) => arg !== '--rollback-empty')) throw new Error('用法：node scripts/finance-backup.ts [--rollback-empty]');
if (!existsSync(filename)) throw new Error('尚无财务数据库，请先启动一次应用。');
const result = await backupFinance(filename,target);
console.log(`已完成一致性备份并校验：${result}`);
if (rollback) {
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
    rollbackEmptyFinance(db);
    console.log('空数据库已回滚到 v0；再次启动应用将重新迁移。');
  } finally { db.close(); }
}
