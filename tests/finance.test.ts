import { test } from 'node:test';
import { parseYuan, centsToInput, yuan } from '../src/finance/money.ts';
import { sum, runway } from '../src/finance/calc.ts';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openFinanceStore } from '../server/finance.ts';
import { AppError } from '../shared/domain.ts';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/app.ts';
import { openStore } from '../server/store.ts';
import { createOllama } from '../server/ollama.ts';
import { listen, close, mockOllama } from './helpers.ts';
import { DatabaseSync } from 'node:sqlite';
import { backupFinance, migrateFinance, rollbackEmptyFinance } from '../server/finance-migrations.ts';

const MONTH = '2026-10';
const DATE = `${MONTH}-15`;
function fixture(t: TestContext) {
  const store = openFinanceStore(':memory:');
  t.after(() => store.close());
  return store;
}
type Store = ReturnType<typeof openFinanceStore>;
function cash(store: Store, name = '测试现金', openingBalance = 100000) {
  return store.createAccount({ name, group: 'cash', kind: 'cash', openingBalance });
}
function tx(accountId: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'expense', amount: 1234, date: DATE, accountId,
    categoryId: 'e_food', note: '合成测试记录', source: 'manual', ...extra,
  };
}
function balance(store: Store, accountId: string) {
  return store.snapshot(MONTH).accounts.find((a) => a.id === accountId)!.balance;
}
function rejects(status = 400) {
  return (e: unknown) => e instanceof AppError && e.status === status;
}
function consumption(store: Store) {
  return store.snapshot(MONTH).transactions.reduce((total, t) =>
    total + (t.type === 'expense' ? t.amount : t.type === 'refund' ? -t.amount : 0), 0);
}

test('real finance starts empty, without importing any demonstration balances or transactions', (t) => {
  const s = fixture(t).snapshot(MONTH);
  assert.equal(s.isDemo, false);
  assert.deepEqual(s.accounts, []);
  assert.deepEqual(s.transactions, []);
  assert.deepEqual(s.liabilities, []);
  assert.ok(s.categories.some((c) => c.id === 'e_food' && c.kind === 'expense'));
  assert.equal(s.budget.month, MONTH);
  assert.equal(s.budget.total, 0);
});

test('balances are derived from opening cents and ledger; historical edits and deletes recalculate', (t) => {
  const s = fixture(t), a = cash(s);
  const expense = s.createTransaction(tx(a.id), 'expense-1');
  const income = s.createTransaction(tx(a.id, { type: 'income', amount: 2500, categoryId: 'i_salary' }), 'income-1');
  assert.equal(balance(s, a.id), 101266);
  s.updateTransaction(expense.id, tx(a.id, { amount: 2000, date: '2026-09-01' }));
  assert.equal(balance(s, a.id), 100500);
  s.deleteTransaction(income.id);
  assert.equal(balance(s, a.id), 98000);
  s.deleteTransaction(expense.id);
  assert.equal(balance(s, a.id), 100000);
});

test('transfer moves equal cents between cash accounts without adding income or consumption', (t) => {
  const s = fixture(t), a = cash(s), b = cash(s, '测试银行卡', 50000);
  const transfer = s.createTransaction(tx(a.id, { type: 'transfer', amount: 20123, categoryId: undefined, toAccountId: b.id }), 'transfer-1');
  assert.equal(balance(s, a.id), 79877);
  assert.equal(balance(s, b.id), 70123);
  assert.equal(balance(s, a.id) + balance(s, b.id), 150000);
  assert.equal(consumption(s), 0);
  assert.equal(s.snapshot(MONTH).transactions.filter((x) => x.type === 'income').length, 0);
  s.updateTransaction(transfer.id, tx(b.id, { type: 'transfer', amount: 10000, categoryId: undefined, toAccountId: a.id }));
  assert.equal(balance(s, a.id), 110000);
  assert.equal(balance(s, b.id), 40000);
  s.deleteTransaction(transfer.id);
  assert.equal(balance(s, a.id), 100000);
  assert.equal(balance(s, b.id), 50000);
});

test('refund restores cash and reduces consumption, never creates ordinary income', (t) => {
  const s = fixture(t), a = cash(s);
  s.createTransaction(tx(a.id, { amount: 5000 }), 'purchase');
  s.createTransaction(tx(a.id, { type: 'refund', amount: 2000 }), 'refund');
  assert.equal(balance(s, a.id), 97000);
  assert.equal(consumption(s), 3000);
  assert.equal(s.snapshot(MONTH).transactions.filter((x) => x.type === 'income').length, 0);
});

test('repayment reduces cash and debt equally; edits and deletion restore debt and due amounts', (t) => {
  const s = fixture(t), a = cash(s);
  const debt = s.createLiability({ name: '合成测试负债', kind: 'credit', balance: 30000, dueAmount: 10000, dueDate: '2026-10-25' });
  const netBefore = balance(s, a.id) - debt.balance;
  s.repayLiability(debt.id, { accountId: a.id, amount: 4000, date: DATE }, 'repay-1');
  let snapshot = s.snapshot(MONTH);
  assert.equal(balance(s, a.id), 96000);
  assert.equal(snapshot.liabilities[0].balance, 26000);
  assert.equal(snapshot.liabilities[0].dueAmount, 6000);
  assert.equal(balance(s, a.id) - snapshot.liabilities[0].balance, netBefore);
  assert.equal(consumption(s), 0);
  const repayment = snapshot.transactions.find((x) => x.type === 'repay')!;
  s.updateTransaction(repayment.id, tx(a.id, { type: 'repay', amount: 10000, categoryId: undefined, liabilityId: debt.id }));
  snapshot = s.snapshot(MONTH);
  assert.equal(snapshot.liabilities[0].balance, 20000);
  assert.equal(snapshot.liabilities[0].dueAmount, 0);
  assert.equal(snapshot.liabilities[0].paidThisPeriod, true);
  s.deleteTransaction(repayment.id);
  snapshot = s.snapshot(MONTH);
  assert.equal(balance(s, a.id), 100000);
  assert.equal(snapshot.liabilities[0].balance, 30000);
  assert.equal(snapshot.liabilities[0].dueAmount, 10000);
  assert.equal(snapshot.liabilities[0].paidThisPeriod, false);
});

test('overpayment and invalid edits roll back the entire transaction', (t) => {
  const s = fixture(t), a = cash(s);
  const debt = s.createLiability({ name: '合成借款', kind: 'personal', balance: 2000, dueAmount: 2000, dueDate: DATE });
  const before = s.snapshot(MONTH);
  assert.throws(() => s.repayLiability(debt.id, { accountId: a.id, amount: 2001, date: DATE }, 'retry-key'), rejects());
  assert.deepEqual(s.snapshot(MONTH), before);
  // A failed operation must not consume the idempotency key.
  s.repayLiability(debt.id, { accountId: a.id, amount: 1000, date: DATE }, 'retry-key');
  const repayment = s.snapshot(MONTH).transactions[0];
  const stable = s.snapshot(MONTH);
  assert.throws(() => s.updateTransaction(repayment.id, tx(a.id, { type: 'repay', categoryId: undefined, amount: 2001, liabilityId: debt.id })), rejects());
  assert.deepEqual(s.snapshot(MONTH), stable);
});

test('persistent idempotency replays one result and rejects a changed request body', (t) => {
  const s = fixture(t), a = cash(s), input = tx(a.id);
  const first = s.createTransaction(input, 'same-request');
  for (let i = 0; i < 5; i++) assert.deepEqual(s.createTransaction(input, 'same-request'), first);
  assert.equal(s.snapshot(MONTH).transactions.length, 1);
  assert.equal(balance(s, a.id), 98766);
  assert.throws(() => s.createTransaction(tx(a.id, { amount: 1235 }), 'same-request'), rejects(409));
  assert.equal(s.snapshot(MONTH).transactions.length, 1);
  assert.throws(() => s.createTransaction(input, ''), rejects());
  assert.throws(() => s.createTransaction(input, 'x'.repeat(129)), rejects());
});

test('repayment idempotency does not reduce cash or debt a second time', (t) => {
  const s = fixture(t), a = cash(s);
  const debt = s.createLiability({ name: '合成还款', kind: 'credit', balance: 5000, dueAmount: 5000, dueDate: DATE });
  const input = { accountId: a.id, amount: 1000, date: DATE };
  s.repayLiability(debt.id, input, 'repayment-key');
  s.repayLiability(debt.id, input, 'repayment-key');
  assert.equal(balance(s, a.id), 99000);
  assert.equal(s.snapshot(MONTH).liabilities[0].balance, 4000);
  assert.equal(s.snapshot(MONTH).transactions.length, 1);
  assert.throws(() => s.repayLiability(debt.id, { ...input, amount: 1001 }, 'repayment-key'), rejects(409));
});

test('SQLite records, budgets and idempotency survive closing and reopening the store', () => {
  const runs = resolve(import.meta.dirname, '../.data/test-runs');
  mkdirSync(runs, { recursive: true });
  const dir = mkdtempSync(join(runs, 'finance-'));
  const filename = join(dir, 'finance.sqlite');
  let s = openFinanceStore(filename);
  try {
    const a = cash(s);
    const input = tx(a.id);
    const first = s.createTransaction(input, 'across-restart');
    s.setBudget(MONTH, { total: 60000, byCategory: { e_food: 20000 } });
    s.close();
    s = openFinanceStore(filename);
    assert.equal(balance(s, a.id), 98766);
    assert.deepEqual(s.createTransaction(input, 'across-restart'), first);
    assert.equal(s.snapshot(MONTH).transactions.length, 1);
    assert.equal(s.snapshot(MONTH).budget.total, 60000);
    assert.equal(s.snapshot(MONTH).budget.byCategory.e_food, 20000);
  } finally {
    s.close();
    assert.ok(dir.startsWith(runs + '\\') || dir.startsWith(runs + '/'));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid amounts, calendar dates, account references and category kinds never write a ledger row', (t) => {
  const s = fixture(t), a = cash(s);
  const changes: Record<string, unknown>[] = [
    { amount: 0 }, { amount: -1 }, { amount: 1.5 }, { amount: Number.NaN },
    { amount: Number.POSITIVE_INFINITY }, { amount: Number.MAX_SAFE_INTEGER + 1 },
    { date: '2026-02-30' }, { date: '2026-13-01' }, { date: '2026-1-01' },
    { accountId: 'does-not-exist' }, { categoryId: 'i_salary' }, { categoryId: 'missing' },
    { type: 'income', categoryId: 'e_food' }, { source: 'ai' }, { source: 'import' },
  ];
  for (const [i, patch] of changes.entries()) {
    assert.throws(() => s.createTransaction(tx(a.id, patch), `invalid-${i}`), AppError, JSON.stringify(patch));
  }
  assert.equal(balance(s, a.id), 100000);
  assert.deepEqual(s.snapshot(MONTH).transactions, []);
});

test('unfinished investment and lending operations are explicitly rejected instead of counted as consumption', (t) => {
  const s = fixture(t), a = cash(s);
  for (const type of ['invest_buy', 'invest_sell', 'lend', 'collect', 'borrow', 'unknown']) {
    assert.throws(() => s.createTransaction(tx(a.id, { type }), `unsupported-${type}`), AppError);
  }
  const investment = s.createAccount({ name: '合成投资账户', kind: 'stock', group: 'investment', openingBalance: 1000 });
  assert.throws(() => s.createTransaction(tx(investment.id), 'noncash-expense'), AppError);
  assert.equal(consumption(s), 0);
  assert.equal(balance(s, a.id), 100000);
});

test('transfer validation rejects self transfer, missing destination and non-cash destination atomically', (t) => {
  const s = fixture(t), a = cash(s);
  const investment = s.createAccount({ name: '合成基金账户', kind: 'fund', group: 'investment', openingBalance: 1000 });
  for (const [i, toAccountId] of [a.id, 'missing', undefined, investment.id].entries()) {
    assert.throws(() => s.createTransaction(tx(a.id, { type: 'transfer', categoryId: undefined, toAccountId }), `bad-transfer-${i}`), AppError);
  }
  assert.equal(balance(s, a.id), 100000);
  assert.equal(balance(s, investment.id), 1000);
  assert.deepEqual(s.snapshot(MONTH).transactions, []);
});

test('month budgets are isolated, integer cents and expense-category validated', (t) => {
  const s = fixture(t);
  s.setBudget('2026-09', { total: 50000, byCategory: { e_food: 20000 } });
  s.setBudget(MONTH, { total: 60000, byCategory: { e_transport: 10000 } });
  assert.equal(s.snapshot('2026-09').budget.total, 50000);
  assert.equal(s.snapshot(MONTH).budget.total, 60000);
  assert.throws(() => s.setBudget('2026-13', { total: 100 }), AppError);
  assert.throws(() => s.setBudget(MONTH, { total: 0.5 }), AppError);
  assert.throws(() => s.setBudget(MONTH, { total: -1 }), AppError);
  assert.throws(() => s.setBudget(MONTH, { byCategory: { i_salary: 100 } }), AppError);
  assert.throws(() => s.setBudget(MONTH, { byCategory: { missing: 100 } }), AppError);
  assert.equal(s.snapshot(MONTH).budget.total, 60000);
});

async function httpFixture(t: TestContext) {
  const finance = openFinanceStore(':memory:');
  const projects = openStore(':memory:');
  const fake = await mockOllama();
  const server = createApp({ finance, store: projects, ollama: createOllama(fake.url), staticDir: '/nonexistent-dist' });
  const url = await listen(server);
  t.after(async () => {
    await close(server);
    await fake.close();
    projects.close();
    finance.close();
  });
  return {
    finance, fake, url,
    request: (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(url + path, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  };
}

test('HTTP finance contract uses Idempotency-Key and supports snapshot, edits, deletes and budget', async (t) => {
  const app = await httpFixture(t);
  const response = await app.request('/api/finance/accounts', 'POST', { name: 'HTTP 测试现金', group: 'cash', kind: 'cash', openingBalance: 100000 });
  assert.equal(response.status, 201);
  const a = await response.json();
  const input = tx(a.id);
  assert.equal((await app.request('/api/finance/transactions', 'POST', input)).status, 400);
  const headers = { 'Idempotency-Key': 'http-request-1' };
  const firstResponse = await app.request('/api/finance/transactions', 'POST', input, headers);
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json();
  const duplicates = await Promise.all(Array.from({ length: 6 }, () => app.request('/api/finance/transactions', 'POST', input, headers)));
  for (const duplicate of duplicates) {
    assert.ok([200, 201].includes(duplicate.status));
    assert.deepEqual(await duplicate.json(), first);
  }
  assert.equal((await app.request('/api/finance/transactions', 'POST', { ...input, amount: 999 }, headers)).status, 409);
  let snapshot = await (await app.request('/api/finance/snapshot')).json();
  assert.equal(snapshot.isDemo, false);
  assert.equal(snapshot.transactions.length, 1);
  assert.equal(snapshot.accounts[0].balance, 98766);
  const edited = await app.request(`/api/finance/transactions/${first.id}`, 'PUT', { ...input, amount: 2000 });
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).amount, 2000);
  assert.equal((await app.request(`/api/finance/budget/${MONTH}`, 'PUT', { total: 100000, byCategory: { e_food: 20000 } })).status, 200);
  assert.equal((await app.request(`/api/finance/transactions/${first.id}`, 'DELETE')).status, 204);
  snapshot = await (await app.request('/api/finance/snapshot')).json();
  assert.equal(snapshot.accounts[0].balance, 100000);
  assert.equal(snapshot.transactions.length, 0);
  assert.equal((await app.request('/api/finance/does-not-exist')).status, 404);
  assert.equal(app.fake.state.chatCalls, 0);
});

test('HTTP repayment and finance errors are explicit and protected by the existing origin and host checks', async (t) => {
  const app = await httpFixture(t);
  const a = cash(app.finance);
  const liability = app.finance.createLiability({ name: 'HTTP 合成负债', kind: 'credit', balance: 5000, dueAmount: 5000, dueDate: DATE });
  const body = { accountId: a.id, amount: 1234, date: DATE };
  const path = `/api/finance/liabilities/${liability.id}/repayments`;
  assert.equal((await app.request(path, 'POST', body, { 'Idempotency-Key': 'http-repay' })).status, 204);
  assert.equal((await app.request(path, 'POST', body, { 'Idempotency-Key': 'http-repay' })).status, 204);
  assert.equal(app.finance.snapshot(MONTH).liabilities[0].balance, 3766);
  assert.equal(balance(app.finance, a.id), 98766);
  const invalid = await app.request('/api/finance/accounts', 'POST', { name: 'bad', group: 'cash', kind: 'cash', openingBalance: 0.1 });
  assert.equal(invalid.status, 400);
  assert.equal(typeof (await invalid.json()).error, 'string');
  assert.equal((await app.request('/api/finance/snapshot', 'GET', undefined, { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await app.request('/api/finance/snapshot', 'GET', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const hostileHostStatus = await new Promise<number | undefined>((resolveStatus, reject) => {
    const req = httpRequest(app.url + '/api/finance/snapshot', { headers: { Host: 'evil.invalid' } }, (res) => {
      res.resume(); resolveStatus(res.statusCode);
    });
    req.on('error', reject); req.end();
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal(app.fake.state.chatCalls, 0);
});

test('online SQLite backup is consistent, preserves idempotency and cannot overwrite an existing file', async () => {
  const runs = resolve(import.meta.dirname, '../.data/test-runs');
  mkdirSync(runs, { recursive: true });
  const dir = mkdtempSync(join(runs, 'backup-'));
  const filename = join(dir, 'finance.sqlite');
  const destination = join(dir, 'backups', 'verified.sqlite');
  const s = openFinanceStore(filename);
  let restored: Store | undefined;
  try {
    const a = cash(s), input = tx(a.id);
    const recorded = s.createTransaction(input, 'before-backup');
    s.setBudget(MONTH, { total: 50000 });
    assert.equal(await backupFinance(filename, destination), resolve(destination));
    // Writes after the snapshot must not appear in the saved backup.
    s.createTransaction(tx(a.id, { amount: 1000 }), 'after-backup');
    restored = openFinanceStore(destination);
    assert.equal(restored.snapshot(MONTH).transactions.length, 1);
    assert.equal(balance(restored, a.id), 98766);
    assert.equal(restored.snapshot(MONTH).budget.total, 50000);
    assert.deepEqual(restored.createTransaction(input, 'before-backup'), recorded);
    assert.equal(restored.snapshot(MONTH).transactions.length, 1);
    await assert.rejects(backupFinance(filename, destination), AppError);
    await assert.rejects(backupFinance(filename, filename), AppError);
    await assert.rejects(backupFinance(join(dir, 'missing.sqlite'), join(dir, 'not-created.sqlite')), rejects(404));
  } finally {
    restored?.close(); s.close();
    assert.ok(dir.startsWith(runs + '\\') || dir.startsWith(runs + '/'));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migration is repeatable, unused database rollback works, and records block destructive rollback', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    migrateFinance(db);
    migrateFinance(db);
    assert.equal(db.prepare('SELECT count(*) AS n FROM finance_schema_migrations').get()!.n, 1);
    rollbackEmptyFinance(db);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'finance_%'").get()!.n, 0);
    migrateFinance(db);
    db.prepare('INSERT INTO finance_accounts(id,name,account_group,kind,opening_balance) VALUES (?,?,?,?,?)').run('fixture', '合成账户', 'cash', 'cash', 1000);
    assert.throws(() => rollbackEmptyFinance(db), rejects(409));
    assert.equal(db.prepare('SELECT opening_balance FROM finance_accounts WHERE id=?').get('fixture')!.opening_balance, 1000);
    assert.equal(db.prepare('SELECT count(*) AS n FROM finance_schema_migrations').get()!.n, 1);
  } finally { db.close(); }
});

test('unknown schema versions and changed migration checksums are rejected before mutation', () => {
  for (const change of ['UPDATE finance_schema_migrations SET version=99', "UPDATE finance_schema_migrations SET checksum='tampered'"]) {
    const db = new DatabaseSync(':memory:');
    try {
      migrateFinance(db);
      db.exec(change);
      const before = db.prepare('SELECT * FROM finance_schema_migrations').all();
      assert.throws(() => migrateFinance(db), rejects(503));
      assert.deepEqual(db.prepare('SELECT * FROM finance_schema_migrations').all(), before);
      assert.equal(db.prepare('SELECT count(*) AS n FROM finance_accounts').get()!.n, 0);
    } finally { db.close(); }
  }
});
test('currency input, display and editing retain the final cent across the safe integer range', () => {
  const max = Number.MAX_SAFE_INTEGER;
  assert.equal(parseYuan('90071992547409.91'), max);
  assert.equal(parseYuan('90071992547409.92'), null);
  assert.equal(parseYuan('12.345'), null);
  assert.equal(parseYuan('0.29'), 29);
  for (const amount of [0, 1, 29, 100, 123456789, max])
    assert.equal(parseYuan(centsToInput(amount)), amount);
  assert.equal(centsToInput(max), '90071992547409.91');
  assert.equal(yuan(max), '¥90,071,992,547,409.91');
  assert.equal(yuan(-max), '-¥90,071,992,547,409.91');
});

test('cent totals do not lose precision during offsetting cash flows and reject unsafe totals', () => {
  assert.equal(sum([Number.MAX_SAFE_INTEGER, 2, -2]), Number.MAX_SAFE_INTEGER);
  assert.throws(() => sum([Number.MAX_SAFE_INTEGER, 1]));
});

test('zero or missing essential spending never claims unlimited runway or a funded reserve', () => {
  const result = runway({ liquid: 10000, upcomingBills: 0, monthlyEssential: 0, reserveMonths: 3, mode: 'normal' });
  assert.equal(result.canEstimate, false);
  assert.equal(result.months, null);
  assert.equal(result.reserveOk, false);
  assert.equal(runway({ liquid: 10000, upcomingBills: 0, monthlyEssential: 1000, reserveMonths: 3, mode: 'normal' }).months, 10);
});
