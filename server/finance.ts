import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { AppError } from '../shared/domain.ts';
import {
  cents, dateString, exactKeys, financeObject, financeText, localMonth, monthString, validateTx,
} from '../shared/finance.ts';
import type { Account, AccountGroup, AccountKind, BudgetSet, Category, FinanceSnapshot, Liability, LiabilityKind, Transaction, TxInput } from '../shared/finance.ts';
import { migrateFinance } from './finance-migrations.ts';

const LIMIT = BigInt(Number.MAX_SAFE_INTEGER);
function safe(n: bigint): number {
  if (n > LIMIT || n < -LIMIT) throw new AppError('累计金额超过安全整数范围，本次未保存。');
  return Number(n);
}
function sumSafe(xs: number[]) { return safe(xs.reduce((a, b) => a + BigInt(b), 0n)); }
function keyString(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value))
    throw new AppError('缺少或无效的 Idempotency-Key（1–128 位字母、数字或 . _ : -）。');
  return value;
}

export function openFinanceStore(filename: string) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;');
  try { migrateFinance(db); } catch (error) { db.close(); throw error; }

  function transaction<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function audit(action: string, id: string, before: unknown, after: unknown) {
    db.prepare('INSERT INTO finance_audit(action,entity_id,before_json,after_json,created_at) VALUES (?,?,?,?,?)')
      .run(action,id,before === undefined ? null : JSON.stringify(before),after === undefined ? null : JSON.stringify(after),new Date().toISOString());
  }
  function getTx(id: string): Transaction {
    const row = db.prepare('SELECT * FROM finance_transactions WHERE id=?').get(id);
    if (!row) throw new AppError('找不到这笔交易。', 404);
    return toTx(row);
  }
  function toTx(row: Record<string, unknown>): Transaction {
    return {
      id: String(row.id), type: row.type as Transaction['type'], amount: Number(row.amount), date: String(row.date),
      accountId: String(row.account_id), note: String(row.note), source: 'manual',
      ...(row.to_account_id === null ? {} : { toAccountId: String(row.to_account_id) }),
      ...(row.category_id === null ? {} : { categoryId: String(row.category_id) }),
      ...(row.liability_id === null ? {} : { liabilityId: String(row.liability_id) }),
    };
  }
  function getBudget(month: string): BudgetSet {
    const row = db.prepare('SELECT total FROM finance_budgets WHERE month=?').get(month);
    const byCategory: Record<string, number> = {};
    for (const c of db.prepare('SELECT category_id,amount FROM finance_budget_categories WHERE month=? ORDER BY category_id').all(month))
      byCategory[String(c.category_id)] = Number(c.amount);
    return { month, total: row ? Number(row.total) : 0, byCategory };
  }
  function state(month: string): FinanceSnapshot {
    const rawAccounts = db.prepare('SELECT * FROM finance_accounts ORDER BY rowid').all();
    const txs = db.prepare('SELECT * FROM finance_transactions ORDER BY date DESC,created_at DESC,rowid DESC').all().map(toTx);
    const values = new Map(rawAccounts.map((a) => [String(a.id), BigInt(Number(a.opening_balance))]));
    const repaid = new Map<string, bigint>();
    const monthlyIncome = new Map<string, bigint>();
    const monthlyExpense = new Map<string, bigint>();
    for (const t of txs) {
      const delta = BigInt(t.amount);
      const out = ['expense','transfer','repay'].includes(t.type) ? -delta : delta;
      values.set(t.accountId, values.get(t.accountId)! + out);
      if (t.type === 'transfer') values.set(t.toAccountId!, values.get(t.toAccountId!)! + delta);
      if (t.type === 'repay') repaid.set(t.liabilityId!, (repaid.get(t.liabilityId!) ?? 0n) + delta);
      const m = t.date.slice(0,7);
      if (t.type === 'income') monthlyIncome.set(m, (monthlyIncome.get(m) ?? 0n) + delta);
      if (t.type === 'expense' || t.type === 'refund') monthlyExpense.set(m,(monthlyExpense.get(m) ?? 0n) + (t.type === 'refund' ? -delta : delta));
    }
    const accounts: Account[] = rawAccounts.map((r) => ({
      id: String(r.id), name: String(r.name), group: r.account_group as AccountGroup, kind: r.kind as AccountKind,
      balance: safe(values.get(String(r.id))!),
    }));
    const liabilities: Liability[] = db.prepare('SELECT * FROM finance_liabilities ORDER BY rowid').all().map((r) => {
      const paid = repaid.get(String(r.id)) ?? 0n;
      const remaining = BigInt(Number(r.opening_balance)) - paid;
      if (remaining < 0n) throw new AppError('累计还款超过负债余额，本次未保存。');
      const due = BigInt(Number(r.opening_due)) - paid;
      return {
        id: String(r.id), name: String(r.name), kind: r.kind as LiabilityKind, balance: safe(remaining),
        dueAmount: safe(due < 0n ? 0n : due), dueDate: String(r.due_date), paidThisPeriod: due <= 0n,
        ...(r.annual_rate === null ? {} : { annualRate: Number(r.annual_rate) }),
      };
    });
    // Bound the complete ledger and absolute balances, so every UI subset and
    // multi-month total remains exactly representable, even after refunds.
    sumSafe(txs.map((t) => t.amount));
    sumSafe(accounts.map((a) => Math.abs(a.balance)));
    const total = sumSafe(accounts.map((a) => a.balance));
    const debt = sumSafe(liabilities.map((l) => l.balance));
    safe(BigInt(total) - BigInt(debt));
    for (const group of ['cash','investment','fixed','receivable']) sumSafe(accounts.filter((a) => a.group === group).map((a) => a.balance));
    const due = sumSafe(liabilities.map((l) => l.dueAmount));
    const cash = sumSafe(accounts.filter((a) => a.group === 'cash').map((a) => a.balance));
    safe(BigInt(cash) - BigInt(due));
    for (const [m, n] of monthlyIncome) {
      safe(n); safe(n - (monthlyExpense.get(m) ?? 0n));
    }
    for (const n of monthlyExpense.values()) safe(n);
    const categories: Category[] = db.prepare('SELECT * FROM finance_categories ORDER BY rowid').all().map((r) => ({
      id: String(r.id), name: String(r.name), kind: r.kind as Category['kind'], essential: r.essential === 1,
    }));
    return { accounts, categories, liabilities, transactions: txs, budget: getBudget(month), isDemo: false };
  }
  function validateLinks(t: TxInput) {
    const a = db.prepare('SELECT account_group FROM finance_accounts WHERE id=?').get(t.accountId);
    if (!a) throw new AppError('付款或收款账户不存在。', 404);
    if (a.account_group !== 'cash') throw new AppError('本轮记账仅支持现金类账户；投资、固定资产和应收款明细尚未开放。');
    if (t.type === 'transfer') {
      const b = db.prepare('SELECT account_group FROM finance_accounts WHERE id=?').get(t.toAccountId!);
      if (!b) throw new AppError('转入账户不存在。', 404);
      if (b.account_group !== 'cash') throw new AppError('本轮仅支持现金类账户间转账。');
    } else if (t.type === 'repay') {
      if (!db.prepare('SELECT id FROM finance_liabilities WHERE id=?').get(t.liabilityId!)) throw new AppError('负债不存在。', 404);
    } else {
      const c = db.prepare('SELECT kind FROM finance_categories WHERE id=?').get(t.categoryId!);
      if (!c || c.kind !== (t.type === 'income' ? 'income' : 'expense')) throw new AppError('请选择与交易类型匹配的分类。');
    }
  }
  function insertTx(t: TxInput): Transaction {
    validateLinks(t);
    const id = randomUUID();
    db.prepare(`INSERT INTO finance_transactions(id,type,amount,date,account_id,to_account_id,category_id,liability_id,note,source,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id,t.type,t.amount,t.date,t.accountId,t.toAccountId ?? null,t.categoryId ?? null,t.liabilityId ?? null,t.note,t.source,new Date().toISOString());
    state(localMonth());
    const result = { id, ...t };
    audit('transaction.create',id,undefined,result);
    return result;
  }
  function idempotent<T>(operation: string, key: unknown, input: unknown, fn: () => T): T {
    const cleanKey = keyString(key);
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return transaction(() => {
      const existing = db.prepare('SELECT request_hash,result_json FROM finance_idempotency WHERE operation=? AND key=?').get(operation,cleanKey);
      if (existing) {
        if (existing.request_hash !== hash) throw new AppError('该幂等键已用于不同请求，请重新确认后再提交。', 409);
        return JSON.parse(String(existing.result_json)) as T;
      }
      const result = fn();
      db.prepare('INSERT INTO finance_idempotency(operation,key,request_hash,result_json,created_at) VALUES (?,?,?,?,?)')
        .run(operation,cleanKey,hash,JSON.stringify(result ?? null),new Date().toISOString());
      return result;
    });
  }
  return {
    close() { db.close(); },
    snapshot(month = localMonth()): FinanceSnapshot {
      monthString(month);
      db.exec('BEGIN');
      try { const result = state(month); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    createTransaction(input: unknown, key: unknown): Transaction {
      const clean = validateTx(input);
      return idempotent('transaction.create', key, clean, () => insertTx(clean));
    },
    updateTransaction(id: string, input: unknown): Transaction {
      const clean = validateTx(input);
      return transaction(() => {
        const before = getTx(id);
        validateLinks(clean);
        db.prepare('UPDATE finance_transactions SET type=?,amount=?,date=?,account_id=?,to_account_id=?,category_id=?,liability_id=?,note=?,source=? WHERE id=?')
          .run(clean.type,clean.amount,clean.date,clean.accountId,clean.toAccountId ?? null,clean.categoryId ?? null,clean.liabilityId ?? null,clean.note,clean.source,id);
        state(localMonth());
        const result = { id, ...clean };
        audit('transaction.update',id,before,result);
        return result;
      });
    },
    deleteTransaction(id: string) {
      transaction(() => {
        const before = getTx(id);
        db.prepare('DELETE FROM finance_transactions WHERE id=?').run(id);
        state(localMonth());
        audit('transaction.delete',id,before,undefined);
      });
    },
    createAccount(input: unknown): Account {
      const a = financeObject(input);
      exactKeys(a,['name','group','kind','openingBalance']);
      const name = financeText(a.name,'账户名');
      const opening = cents(a.openingBalance,'初始余额',true);
      if (!['cash','investment','fixed','receivable'].includes(String(a.group)) || !['alipay','wechat','bank','cash','fund','stock','other'].includes(String(a.kind)))
        throw new AppError('账户类型不正确。');
      if ((a.group === 'cash' && ['fund','stock'].includes(String(a.kind))) || (a.group !== 'cash' && ['alipay','wechat','bank','cash'].includes(String(a.kind))))
        throw new AppError('账户分组与类型不匹配。');
      return transaction(() => {
        const id = randomUUID();
        db.prepare('INSERT INTO finance_accounts(id,name,account_group,kind,opening_balance) VALUES (?,?,?,?,?)').run(id,name,String(a.group),String(a.kind),opening);
        state(localMonth());
        const result = { id, name, group: a.group as AccountGroup, kind: a.kind as AccountKind, balance: opening };
        audit('account.create',id,undefined,{ ...result, openingBalance: opening });
        return result;
      });
    },
    setBudget(month: string, input: unknown): BudgetSet {
      monthString(month);
      const patch = financeObject(input);
      exactKeys(patch,['total','byCategory']);
      if (!Object.keys(patch).length) throw new AppError('请提供预算总额或分类预算。');
      if (patch.total !== undefined) cents(patch.total,'预算总额',true);
      const categories = patch.byCategory === undefined ? undefined : financeObject(patch.byCategory);
      if (categories) {
        for (const amount of Object.values(categories)) cents(amount,'分类预算',true);
        sumSafe(Object.values(categories) as number[]);
      }
      return transaction(() => {
        const before = getBudget(month);
        for (const id of Object.keys(categories ?? {})) {
          if (db.prepare('SELECT kind FROM finance_categories WHERE id=?').get(id)?.kind !== 'expense') throw new AppError('分类预算只能使用支出分类。');
        }
        const total = patch.total === undefined ? before.total : Number(patch.total);
        db.prepare('INSERT INTO finance_budgets(month,total) VALUES (?,?) ON CONFLICT(month) DO UPDATE SET total=excluded.total').run(month,total);
        if (categories) {
          db.prepare('DELETE FROM finance_budget_categories WHERE month=?').run(month);
          const insert = db.prepare('INSERT INTO finance_budget_categories(month,category_id,amount) VALUES (?,?,?)');
          for (const [id,amount] of Object.entries(categories)) insert.run(month,id,Number(amount));
        }
        const result = getBudget(month);
        audit('budget.set',month,before,result);
        return result;
      });
    },
    repayLiability(id: string, input: unknown, key: unknown): void {
      const v = financeObject(input);
      exactKeys(v,['accountId','amount','date']);
      const clean = validateTx({ type: 'repay', accountId: v.accountId, amount: v.amount, date: v.date, liabilityId: id, note: '', source: 'manual' });
      idempotent('liability.repay',key,clean,() => insertTx(clean));
    },
    /** Internal fixture/future workflow only; not exposed through the HTTP API in this phase. */
    createLiability(input: unknown): Liability {
      const l = financeObject(input);
      exactKeys(l,['name','kind','balance','dueAmount','dueDate','annualRate']);
      const name = financeText(l.name,'负债名');
      const balance = cents(l.balance,'负债本金');
      const dueAmount = cents(l.dueAmount,'本期应还',true);
      const dueDate = dateString(l.dueDate);
      if (dueAmount > balance) throw new AppError('本期应还不能超过负债本金。');
      if (!['huabei','baitiao','credit','personal','loan'].includes(String(l.kind))) throw new AppError('负债类型不正确。');
      if (l.annualRate !== undefined && (typeof l.annualRate !== 'number' || !Number.isFinite(l.annualRate) || l.annualRate < 0 || l.annualRate > 1)) throw new AppError('年化利率需为 0–1 之间的数字。');
      return transaction(() => {
        const id = randomUUID();
        db.prepare('INSERT INTO finance_liabilities(id,name,kind,opening_balance,opening_due,due_date,annual_rate) VALUES (?,?,?,?,?,?,?)')
          .run(id,name,String(l.kind),balance,dueAmount,dueDate,l.annualRate === undefined ? null : Number(l.annualRate));
        const result = state(localMonth()).liabilities.find((x) => x.id === id)!;
        audit('liability.create',id,undefined,result);
        return result;
      });
    },
  };
}
export type FinanceStore = ReturnType<typeof openFinanceStore>;
