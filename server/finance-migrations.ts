import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AppError } from '../shared/domain.ts';
import { DEFAULT_CATEGORIES } from '../shared/finance.ts';

const UP = `
CREATE TABLE finance_accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  account_group TEXT NOT NULL CHECK(account_group IN ('cash','investment','fixed','receivable')),
  kind TEXT NOT NULL CHECK(kind IN ('alipay','wechat','bank','cash','fund','stock','other')),
  opening_balance INTEGER NOT NULL CHECK(opening_balance BETWEEN 0 AND 9007199254740991)
) STRICT;
CREATE TABLE finance_categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('expense','income')),
  essential INTEGER NOT NULL CHECK(essential IN (0,1))
) STRICT;
CREATE TABLE finance_liabilities (
  id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  kind TEXT NOT NULL CHECK(kind IN ('huabei','baitiao','credit','personal','loan')),
  opening_balance INTEGER NOT NULL CHECK(opening_balance BETWEEN 1 AND 9007199254740991),
  opening_due INTEGER NOT NULL CHECK(opening_due BETWEEN 0 AND opening_balance),
  due_date TEXT NOT NULL CHECK(length(due_date)=10), annual_rate REAL CHECK(annual_rate BETWEEN 0 AND 1)
) STRICT;
CREATE TABLE finance_transactions (
  id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('expense','income','transfer','repay','refund')),
  amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 9007199254740991),
  date TEXT NOT NULL CHECK(length(date)=10), account_id TEXT NOT NULL REFERENCES finance_accounts(id),
  to_account_id TEXT REFERENCES finance_accounts(id), category_id TEXT REFERENCES finance_categories(id),
  liability_id TEXT REFERENCES finance_liabilities(id), note TEXT NOT NULL CHECK(length(note)<=1000),
  source TEXT NOT NULL CHECK(source='manual'), created_at TEXT NOT NULL,
  CHECK((type='transfer' AND to_account_id IS NOT NULL AND to_account_id<>account_id AND category_id IS NULL AND liability_id IS NULL)
    OR (type='repay' AND liability_id IS NOT NULL AND to_account_id IS NULL AND category_id IS NULL)
    OR (type IN ('expense','income','refund') AND category_id IS NOT NULL AND to_account_id IS NULL AND liability_id IS NULL))
) STRICT;
CREATE INDEX finance_tx_date ON finance_transactions(date);
CREATE INDEX finance_tx_account ON finance_transactions(account_id);
CREATE INDEX finance_tx_liability ON finance_transactions(liability_id);
CREATE TABLE finance_budgets (
  month TEXT PRIMARY KEY CHECK(length(month)=7), total INTEGER NOT NULL CHECK(total BETWEEN 0 AND 9007199254740991)
) STRICT;
CREATE TABLE finance_budget_categories (
  month TEXT NOT NULL REFERENCES finance_budgets(month) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES finance_categories(id), amount INTEGER NOT NULL CHECK(amount BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(month,category_id)
) STRICT;
CREATE TABLE finance_idempotency (
  operation TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL, result_json TEXT NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY(operation,key)
) STRICT;
CREATE TABLE finance_audit (
  id INTEGER PRIMARY KEY, action TEXT NOT NULL, entity_id TEXT NOT NULL,
  before_json TEXT, after_json TEXT, created_at TEXT NOT NULL
) STRICT;`;
const CHECKSUM = createHash('sha256').update(UP).digest('hex');
export const FINANCE_SCHEMA_VERSION = 1;

export function migrateFinance(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS finance_schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT');
    const versions = db.prepare('SELECT version, checksum FROM finance_schema_migrations ORDER BY version').all();
    if (versions.some((r) => Number(r.version) > FINANCE_SCHEMA_VERSION)) throw new AppError('财务数据库版本较新，请使用匹配的应用版本。', 503);
    if (versions.length && (versions.length !== 1 || versions[0]!.version !== 1 || versions[0]!.checksum !== CHECKSUM))
      throw new AppError('财务迁移校验失败，拒绝修改数据库。', 503);
    if (!versions.length) {
      db.exec(UP);
      const insert = db.prepare('INSERT INTO finance_categories(id,name,kind,essential) VALUES (?,?,?,?)');
      for (const c of DEFAULT_CATEGORIES) insert.run(c.id, c.name, c.kind, c.essential ? 1 : 0);
      db.prepare('INSERT INTO finance_schema_migrations(version,checksum,applied_at) VALUES (1,?,?)').run(CHECKSUM,new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

/** Only an unused v1 database may be migrated down. User records require restoring a verified backup. */
export function rollbackEmptyFinance(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const version = db.prepare('SELECT version,checksum FROM finance_schema_migrations').all();
    if (version.length !== 1 || version[0]!.version !== 1 || version[0]!.checksum !== CHECKSUM)
      throw new AppError('仅支持从已验证的财务 v1 回滚。');
    for (const table of ['finance_accounts','finance_transactions','finance_liabilities','finance_budgets','finance_audit','finance_idempotency']) {
      if (db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) throw new AppError('数据库已有用户记录，拒绝破坏性回滚；请停服并恢复已验证备份。', 409);
    }
    db.exec('DROP TABLE finance_budget_categories; DROP TABLE finance_budgets; DROP TABLE finance_transactions; DROP TABLE finance_accounts; DROP TABLE finance_liabilities; DROP TABLE finance_categories; DROP TABLE finance_idempotency; DROP TABLE finance_audit; DROP TABLE finance_schema_migrations;');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export async function backupFinance(filename: string, destination: string) {
  if (!existsSync(filename)) throw new AppError('财务数据库不存在，未创建空备份。', 404);
  if (resolve(filename) === resolve(destination) || existsSync(destination)) throw new AppError('备份目标必须是新的文件。');
  mkdirSync(dirname(destination), { recursive: true });
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    await backup(db, destination);
    const verify = new DatabaseSync(destination, { readOnly: true });
    try {
      const check = verify.prepare('PRAGMA integrity_check').get();
      if (check?.integrity_check !== 'ok') throw new AppError('备份完整性校验失败。', 500);
      if (verify.prepare('PRAGMA foreign_key_check').all().length) throw new AppError('备份关联校验失败。', 500);
    } finally { verify.close(); }
  } finally { db.close(); }
  return resolve(destination);
}
