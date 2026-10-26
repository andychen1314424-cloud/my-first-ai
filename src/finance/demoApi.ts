// 演示数据层：全部为虚构数据，仅用于界面演示。不会写入任何数据库。
import type { FinanceApi } from './api';
import { applyTx, currentMonth, shiftMonth, toDateStr } from './calc';
import type { Account, BudgetSet, Category, FinanceSnapshot, Liability, Transaction } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const CATEGORIES: Category[] = [
  { id: 'food', name: '餐饮', kind: 'expense', essential: true },
  { id: 'transport', name: '交通', kind: 'expense', essential: true },
  { id: 'home', name: '居住', kind: 'expense', essential: true },
  { id: 'comm', name: '通讯', kind: 'expense', essential: true },
  { id: 'health', name: '医疗', kind: 'expense', essential: true },
  { id: 'shop', name: '购物', kind: 'expense' },
  { id: 'fun', name: '娱乐', kind: 'expense' },
  { id: 'learn', name: '学习', kind: 'expense' },
  { id: 'other', name: '其他', kind: 'expense' },
  { id: 'salary', name: '工资', kind: 'income' },
  { id: 'side', name: '兼职与奖金', kind: 'income' },
  { id: 'otherin', name: '其他收入', kind: 'income' },
];

const ACCOUNTS: Account[] = [
  { id: 'a_alipay', name: '支付宝', group: 'cash', kind: 'alipay', balance: 842650 },
  { id: 'a_wechat', name: '微信零钱', group: 'cash', kind: 'wechat', balance: 123800 },
  { id: 'a_bank', name: '储蓄卡', group: 'cash', kind: 'bank', balance: 3650000 },
  { id: 'a_cash', name: '现金', group: 'cash', kind: 'cash', balance: 60000 },
  { id: 'a_fund', name: '基金账户', group: 'investment', kind: 'fund', balance: 4200000 },
  { id: 'a_stock', name: '股票账户', group: 'investment', kind: 'stock', balance: 1880000 },
  { id: 'a_pf', name: '住房公积金', group: 'fixed', kind: 'other', balance: 2500000 },
  { id: 'a_recv', name: '借出款项', group: 'receivable', kind: 'other', balance: 200000 },
];

function liabilities(): Liability[] {
  const d = (n: number) => {
    const x = new Date();
    x.setDate(x.getDate() + n);
    return toDateStr(x);
  };
  return [
    { id: 'l_huabei', name: '花呗', kind: 'huabei', balance: 326000, dueAmount: 326000, dueDate: d(9), paidThisPeriod: false },
    { id: 'l_baitiao', name: '京东白条', kind: 'baitiao', balance: 148000, dueAmount: 148000, dueDate: d(14), paidThisPeriod: false },
    { id: 'l_credit', name: '信用卡', kind: 'credit', balance: 572000, dueAmount: 572000, dueDate: d(23), annualRate: 0.1825, paidThisPeriod: false },
    { id: 'l_loan', name: '个人借款', kind: 'personal', balance: 1000000, dueAmount: 100000, dueDate: d(40), annualRate: 0, paidThisPeriod: false },
  ];
}

// 固定种子，保证每次演示数据一致
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const NOTES: Record<string, string[]> = {
  food: ['午饭', '咖啡', '晚餐', '早餐', '超市买菜', '外卖', '朋友聚餐'],
  transport: ['地铁', '打车', '公交', '加油'],
  shop: ['日用品', '衣服', '电子配件', '网购'],
  fun: ['电影', '游戏充值', '订阅服务', '健身'],
  health: ['药店', '体检'],
  learn: ['书籍', '在线课程'],
  other: ['杂项', '快递费'],
};
const RANGE: Record<string, [number, number, number]> = {
  food: [1800, 9500, 11],
  transport: [300, 4500, 5],
  shop: [3000, 38000, 3],
  fun: [2500, 14000, 2],
  health: [2000, 18000, 1],
  learn: [5000, 25000, 1],
  other: [800, 6000, 1],
};

function genTransactions(): Transaction[] {
  const out: Transaction[] = [];
  const r = rng(20261026);
  const today = new Date();
  const cur = currentMonth();
  let n = 0;
  const id = () => `t_${++n}`;
  const weighted = Object.entries(RANGE).flatMap(([k, [, , w]]) => Array(w).fill(k) as string[]);
  const accounts = ['a_alipay', 'a_wechat', 'a_bank', 'a_wechat', 'a_alipay'];
  for (let i = -5; i <= 0; i++) {
    const m = shiftMonth(cur, i);
    const [y, mo] = m.split('-').map(Number);
    const lastDay = i === 0 ? today.getDate() : new Date(y, mo, 0).getDate();
    const date = (day: number) => `${m}-${String(day).padStart(2, '0')}`;
    if (lastDay >= 1) out.push({ id: id(), type: 'expense', amount: 320000, date: date(1), accountId: 'a_bank', categoryId: 'home', note: '房租', source: 'manual' });
    if (lastDay >= 5) out.push({ id: id(), type: 'expense', amount: 9900, date: date(5), accountId: 'a_alipay', categoryId: 'comm', note: '话费与宽带', source: 'manual' });
    if (lastDay >= 10) out.push({ id: id(), type: 'income', amount: 1800000, date: date(10), accountId: 'a_bank', categoryId: 'salary', note: '工资', source: 'manual' });
    if (lastDay >= 18 && i % 2 === 0) out.push({ id: id(), type: 'income', amount: Math.round((120000 + r() * 80000) / 10000) * 10000, date: date(18), accountId: 'a_alipay', categoryId: 'side', note: '兼职收入', source: 'manual' });
    const count = Math.round((lastDay / 30) * 26);
    for (let k = 0; k < count; k++) {
      const cat = weighted[Math.floor(r() * weighted.length)];
      const [lo, hi] = RANGE[cat];
      const amount = Math.round((lo + r() * (hi - lo)) / 10) * 10;
      const notes = NOTES[cat];
      out.push({
        id: id(),
        type: 'expense',
        amount,
        date: date(1 + Math.floor(r() * lastDay)),
        accountId: accounts[Math.floor(r() * accounts.length)],
        categoryId: cat,
        note: notes[Math.floor(r() * notes.length)],
        source: 'manual',
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function initial(): FinanceSnapshot {
  const m = currentMonth();
  const budget: BudgetSet = {
    month: m,
    total: 900000,
    byCategory: { food: 220000, transport: 40000, home: 320000, comm: 12000, health: 30000, shop: 100000, fun: 60000, learn: 40000, other: 20000 },
  };
  return { accounts: ACCOUNTS.map((a) => ({ ...a })), categories: CATEGORIES, liabilities: liabilities(), transactions: genTransactions(), budget, isDemo: true };
}

let state = initial();
let nextId = 10000;
const seen = new Map<string, Transaction>();

const byDateDesc = (a: Transaction, b: Transaction) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
const clone = <T,>(x: T): T => structuredClone(x);

export const demoApi: FinanceApi = {
  async getSnapshot() {
    await sleep(220);
    return clone(state);
  },
  async createTransaction(input, key) {
    await sleep(160);
    const prior = seen.get(key);
    if (prior) return clone(prior); // 幂等：重复提交不会重复记账
    const t: Transaction = { ...input, id: `t_${++nextId}` };
    state = { ...state, transactions: [t, ...state.transactions].sort(byDateDesc), accounts: applyTx(state.accounts, t) };
    seen.set(key, t);
    return clone(t);
  },
  async updateTransaction(id, input) {
    await sleep(160);
    const old = state.transactions.find((t) => t.id === id);
    if (!old) throw new Error('这笔记录不存在或已被删除');
    const t: Transaction = { ...input, id };
    const accounts = applyTx(applyTx(state.accounts, old, -1), t);
    state = { ...state, accounts, transactions: state.transactions.map((x) => (x.id === id ? t : x)).sort(byDateDesc) };
    return clone(t);
  },
  async deleteTransaction(id) {
    await sleep(140);
    const old = state.transactions.find((t) => t.id === id);
    if (!old) return;
    state = { ...state, accounts: applyTx(state.accounts, old, -1), transactions: state.transactions.filter((t) => t.id !== id) };
  },
  async createAccount(input) {
    await sleep(140);
    const a: Account = { id: `a_${++nextId}`, name: input.name, group: input.group, kind: input.kind, balance: input.openingBalance };
    state = { ...state, accounts: [...state.accounts, a] };
    return clone(a);
  },
  async setBudget(month, patch) {
    await sleep(120);
    const b: BudgetSet = {
      month,
      total: patch.total ?? state.budget.total,
      byCategory: { ...state.budget.byCategory, ...(patch.byCategory ?? {}) },
    };
    state = { ...state, budget: b };
    return clone(b);
  },
  async repayLiability(id, input, key) {
    await sleep(180);
    if (seen.has(key)) return;
    const l = state.liabilities.find((x) => x.id === id);
    if (!l) throw new Error('这笔负债不存在');
    if (input.amount > l.balance) throw new Error('还款金额不能超过当前余额');
    // 还款只减少「现金」和「负债余额」，不计入消费
    const t: Transaction = { id: `t_${++nextId}`, type: 'repay', amount: input.amount, date: input.date, accountId: input.accountId, liabilityId: id, note: `还款 ${l.name}`, source: 'manual' };
    seen.set(key, t);
    state = {
      ...state,
      accounts: applyTx(state.accounts, t),
      transactions: [t, ...state.transactions],
      liabilities: state.liabilities.map((x) =>
        x.id === id ? { ...x, balance: x.balance - input.amount, paidThisPeriod: input.amount >= x.dueAmount || x.paidThisPeriod } : x,
      ),
    };
  },
  async resetDemo() {
    state = initial();
    seen.clear();
  },
};
