import { AppError } from './domain.ts';

export type Cents = number;
export type AccountGroup = 'cash' | 'investment' | 'fixed' | 'receivable';
export type AccountKind = 'alipay' | 'wechat' | 'bank' | 'cash' | 'fund' | 'stock' | 'other';
export type Account = { id: string; name: string; group: AccountGroup; kind: AccountKind; balance: Cents };
export type Category = { id: string; name: string; kind: 'expense' | 'income'; essential?: boolean };
export type TxType = 'expense' | 'income' | 'transfer' | 'repay' | 'refund';
export type Transaction = {
  id: string; type: TxType; amount: Cents; date: string; accountId: string;
  toAccountId?: string; categoryId?: string; liabilityId?: string; note: string; source: 'manual';
};
export type TxInput = Omit<Transaction, 'id'>;
export type LiabilityKind = 'huabei' | 'baitiao' | 'credit' | 'personal' | 'loan';
export type Liability = {
  id: string; name: string; kind: LiabilityKind; balance: Cents; dueAmount: Cents;
  dueDate: string; annualRate?: number; paidThisPeriod: boolean;
};
export type BudgetSet = { month: string; total: Cents; byCategory: Record<string, Cents> };
export type FinanceSnapshot = {
  accounts: Account[]; categories: Category[]; liabilities: Liability[];
  transactions: Transaction[]; budget: BudgetSet; isDemo: false;
};
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'e_food', name: '餐饮', kind: 'expense', essential: true },
  { id: 'e_transport', name: '交通', kind: 'expense', essential: true },
  { id: 'e_home', name: '居住', kind: 'expense', essential: true },
  { id: 'e_other', name: '其他支出', kind: 'expense' },
  { id: 'i_salary', name: '工资', kind: 'income' },
  { id: 'i_other', name: '其他收入', kind: 'income' },
];
export function financeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('财务数据格式不正确。');
  return value as Record<string, unknown>;
}
export function exactKeys(o: Record<string, unknown>, keys: string[]) {
  if (Object.keys(o).some((key) => !keys.includes(key))) throw new AppError('包含不支持的财务字段。');
}
export function financeText(value: unknown, label: string, max = 100, empty = false): string {
  if (typeof value !== 'string' || value.trim().length > max || (!empty && !value.trim()))
    throw new AppError(`${label}格式不正确。`);
  return value.trim();
}
export function cents(value: unknown, label = '金额', allowZero = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
    throw new AppError(`${label}必须是${allowZero ? '非负' : '正'}的安全整数分。`);
  return value;
}
export function dateString(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError('日期需为 YYYY-MM-DD。');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || Number(value.slice(0, 4)) < 1900)
    throw new AppError('日期不存在或早于 1900 年。');
  return value;
}
export function monthString(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || Number(value.slice(0, 4)) < 1900)
    throw new AppError('月份需为合法的 YYYY-MM。');
  return value;
}
export function localMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function validateTx(value: unknown): TxInput {
  const t = financeObject(value);
  exactKeys(t, ['type', 'amount', 'date', 'accountId', 'toAccountId', 'categoryId', 'liabilityId', 'note', 'source']);
  if (!['expense', 'income', 'transfer', 'repay', 'refund'].includes(String(t.type)))
    throw new AppError('本轮仅支持支出、收入、转账、退款和还款。投资及借贷记账尚未开放。');
  if (t.source !== 'manual') throw new AppError('当前仅支持手动确认的记录，AI 和账单导入尚未接入。');
  const result: TxInput = {
    type: t.type as TxType, amount: cents(t.amount), date: dateString(t.date),
    accountId: financeText(t.accountId, '账户编号'), note: financeText(t.note ?? '', '备注', 1000, true), source: 'manual',
  };
  for (const key of ['toAccountId', 'categoryId', 'liabilityId'] as const)
    if (t[key] !== undefined && t[key] !== '') result[key] = financeText(t[key], '关联编号');
  if (result.type === 'transfer') {
    if (!result.toAccountId || result.toAccountId === result.accountId || result.categoryId || result.liabilityId)
      throw new AppError('转账需要两个不同的账户，且不能携带收支分类或负债。');
  } else if (result.type === 'repay') {
    if (!result.liabilityId || result.toAccountId || result.categoryId) throw new AppError('还款需指定负债，不能携带转入账户或收支分类。');
  } else if (!result.categoryId || result.toAccountId || result.liabilityId) {
    throw new AppError('收支及退款需指定分类，不能携带转入账户或负债。');
  }
  return result;
}
