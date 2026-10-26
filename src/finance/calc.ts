// 所有财务计算都是确定性纯函数，不依赖任何语言模型。
// 正式版：这些计算应迁移到后端并以后端结果为准，前端仅展示。
import type { Account, AccountGroup, Cents, FinanceSnapshot, Transaction, Liability } from './types';

export const GROUP_LABEL: Record<AccountGroup, string> = {
  cash: '现金及银行存款',
  investment: '投资资产',
  fixed: '非流动资产',
  receivable: '应收款项',
};
export const GROUP_ORDER: AccountGroup[] = ['cash', 'investment', 'fixed', 'receivable'];

const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
function safeCents(value: bigint): Cents {
  if (value > MAX_CENTS || value < -MAX_CENTS) throw new RangeError('金额合计超出安全范围。');
  return Number(value);
}
function sumCents(xs: Cents[]): bigint {
  return xs.reduce((total, value) => {
    if (!Number.isSafeInteger(value)) throw new RangeError('金额必须是安全的整数分。');
    return total + BigInt(value);
  }, 0n);
}
export const sum = (xs: Cents[]): Cents => safeCents(sumCents(xs));

export const monthKey = (d: string) => d.slice(0, 7);
export const todayStr = () => toDateStr(new Date());
export const toDateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const currentMonth = () => todayStr().slice(0, 7);

export function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function daysUntil(date: string, from = todayStr()): number {
  const a = new Date(from + 'T00:00:00').getTime();
  const b = new Date(date + 'T00:00:00').getTime();
  return Math.round((b - a) / 86400000);
}

/** 计入「消费」的只有 expense（退款冲减）。转账、还款、投资买卖、借贷都不是消费。 */
export function expenseOf(t: Transaction): Cents {
  if (t.type === 'expense') return t.amount;
  if (t.type === 'refund') return -t.amount;
  return 0;
}
export function incomeOf(t: Transaction): Cents {
  return t.type === 'income' ? t.amount : 0;
}

export function balances(accounts: Account[]) {
  const by = (g: AccountGroup) => sum(accounts.filter((a) => a.group === g).map((a) => a.balance));
  const cash = by('cash');
  const investment = by('investment');
  const fixed = by('fixed');
  const receivable = by('receivable');
  return { cash, investment, fixed, receivable, total: cash + investment + fixed + receivable };
}

/** 30 天内到期、尚未还清的负债本期应还额 */
export function upcomingDue(liabs: Liability[], days = 30): Cents {
  return sum(
    liabs.filter((l) => !l.paidThisPeriod && daysUntil(l.dueDate) <= days).map((l) => l.dueAmount),
  );
}

export function overview(s: FinanceSnapshot, month = currentMonth()) {
  const b = balances(s.accounts);
  const liabilities = sum(s.liabilities.map((l) => l.balance));
  const due30 = upcomingDue(s.liabilities);
  const tx = s.transactions.filter((t) => monthKey(t.date) === month);
  const income = sum(tx.map(incomeOf));
  const expense = sum(tx.map(expenseOf));
  // 可支配资金 = 现金及银行存款 − 30 天内到期还款（不是总资产）
  const disposable = b.cash - due30;
  const budgetUsed = s.budget.total > 0 ? expense / s.budget.total : 0;
  return {
    ...b,
    liabilities,
    net: b.total - liabilities,
    due30,
    disposable,
    income,
    expense,
    balance: income - expense,
    budgetUsed,
  };
}

export function spendByCategory(txs: Transaction[], month: string): Record<string, Cents> {
  const out: Record<string, Cents> = {};
  for (const t of txs) {
    if (monthKey(t.date) !== month) continue;
    const e = expenseOf(t);
    if (e !== 0 && t.categoryId) out[t.categoryId] = (out[t.categoryId] ?? 0) + e;
  }
  return out;
}

export function monthlyTrend(txs: Transaction[], endMonth: string, n = 6) {
  const months = Array.from({ length: n }, (_, i) => shiftMonth(endMonth, i - (n - 1)));
  return months.map((m) => {
    const inMonth = txs.filter((t) => monthKey(t.date) === m);
    return { month: m, income: sum(inMonth.map(incomeOf)), expense: sum(inMonth.map(expenseOf)) };
  });
}

/** 资金可支撑时间。返回结果同时带上假设，界面必须展示。 */
export type RunwayMode = 'frugal' | 'normal' | 'relaxed';
export const RUNWAY_FACTOR: Record<RunwayMode, number> = { frugal: 0.7, normal: 1, relaxed: 1.25 };

export function runway(input: {
  liquid: Cents;
  upcomingBills: Cents;
  monthlyEssential: Cents;
  reserveMonths: number;
  mode: RunwayMode;
}) {
  const factor = RUNWAY_FACTOR[input.mode];
  const monthlySpend = Math.round(input.monthlyEssential * factor);
  const usable = Math.max(0, input.liquid - input.upcomingBills);
  const canEstimate = Number.isSafeInteger(input.monthlyEssential) && input.monthlyEssential > 0 && monthlySpend > 0;
  const months = canEstimate ? usable / monthlySpend : null;
  const reserveTarget = monthlySpend * input.reserveMonths;
  return {
    monthlySpend,
    usable,
    months,
    canEstimate,
    reserveTarget,
    reserveOk: canEstimate && usable >= reserveTarget,
    assumptions: [
      `未来 12 个月无任何收入`,
      `只动用现金及银行存款，不变现投资和非流动资产`,
      `先扣除 30 天内到期的确定性账单`,
      `月支出按必要支出的 ${Math.round(factor * 100)}% 计算`,
      `不计利息收益与物价变化`,
    ],
  };
}

export function avgEssentialMonthly(s: FinanceSnapshot, endMonth: string, n = 3): Cents {
  if (!Number.isSafeInteger(n) || n <= 0) throw new RangeError('平均月份数必须是正整数。');
  const ess = new Set(s.categories.filter((c) => c.essential).map((c) => c.id));
  const months = Array.from({ length: n }, (_, i) => shiftMonth(endMonth, -(i + 1)));
  const total = sumCents(
    s.transactions
      .filter((t) => months.includes(monthKey(t.date)) && t.categoryId && ess.has(t.categoryId))
      .map(expenseOf),
  );
  const divisor = BigInt(n);
  let rounded = total / divisor;
  const remainder = total % divisor;
  // Match Math.round's tie direction without converting the total to a float.
  if (remainder * 2n >= divisor) rounded += 1n;
  else if (remainder * 2n < -divisor) rounded -= 1n;
  return safeCents(rounded);
}

/** 没有完整的历史覆盖范围元数据时，保守要求每个月都有必要消费记录。
 * 记录不足时由用户明确填写月支出，不能把未记录的月份当成零支出。 */
export function hasEssentialHistory(s: FinanceSnapshot, endMonth: string, n = 3): boolean {
  const essential = new Set(s.categories.filter((c) => c.essential).map((c) => c.id));
  return Array.from({ length: n }, (_, i) => shiftMonth(endMonth, -(i + 1))).every((month) =>
    s.transactions.some((t) => monthKey(t.date) === month && t.type === 'expense' && t.categoryId && essential.has(t.categoryId)),
  );
}

/** 交易对账户余额的影响（用于演示后端的记账规则） */
export function applyTx(accounts: Account[], t: Transaction, dir: 1 | -1 = 1): Account[] {
  const delta = (id: string | undefined, amt: Cents) =>
    accounts.map((a) => (a.id === id ? { ...a, balance: a.balance + amt * dir } : a));
  switch (t.type) {
    case 'income':
    case 'refund':
    case 'collect':
    case 'borrow':
      return delta(t.accountId, t.amount);
    case 'expense':
    case 'lend':
    case 'repay':
      return delta(t.accountId, -t.amount);
    case 'transfer': {
      const from = accounts.map((a) => (a.id === t.accountId ? { ...a, balance: a.balance - t.amount * dir } : a));
      return from.map((a) => (a.id === t.toAccountId ? { ...a, balance: a.balance + t.amount * dir } : a));
    }
    default:
      return accounts;
  }
}
