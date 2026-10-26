// 所有金额均为「分」(整数)。后端同样使用整数分，避免浮点误差。
export type Cents = number;

export type AccountGroup = 'cash' | 'investment' | 'fixed' | 'receivable';

export interface Account {
  id: string;
  name: string;
  group: AccountGroup;
  kind: 'alipay' | 'wechat' | 'bank' | 'cash' | 'fund' | 'stock' | 'other';
  balance: Cents; // 演示：由初始余额与流水推算；正式版由后端计算
}

export type TxType =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'invest_buy'
  | 'invest_sell'
  | 'lend'
  | 'collect'
  | 'borrow'
  | 'repay'
  | 'refund';

export interface Transaction {
  id: string;
  type: TxType;
  amount: Cents; // 永远为正数，方向由 type 决定
  date: string; // YYYY-MM-DD
  accountId: string; // 转出/支付/收款账户
  toAccountId?: string; // 仅转账
  categoryId?: string; // 收支才有
  liabilityId?: string; // 仅还款
  note: string;
  source: 'manual' | 'ai' | 'import';
}

export interface Category {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  essential?: boolean; // 必要支出，用于生存时间计算
}

export interface Liability {
  id: string;
  name: string;
  kind: 'huabei' | 'baitiao' | 'credit' | 'personal' | 'loan';
  balance: Cents;
  dueAmount: Cents; // 本期应还
  dueDate: string; // YYYY-MM-DD
  annualRate?: number; // 年化，0.0 ~ 1
  paidThisPeriod: boolean;
}

export interface BudgetSet {
  month: string; // YYYY-MM
  total: Cents;
  byCategory: Record<string, Cents>;
}

export interface FinanceSnapshot {
  accounts: Account[];
  categories: Category[];
  liabilities: Liability[];
  transactions: Transaction[];
  budget: BudgetSet;
  isDemo: boolean;
}

export type TxInput = Omit<Transaction, 'id'>;
