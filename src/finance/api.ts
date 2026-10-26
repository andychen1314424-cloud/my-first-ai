// ZX Finance 前端数据层接口。
// 默认同源 HTTP API，使用本地 SQLite。演示代码保留作界面参考，默认不加载。
import type { Account, AccountGroup, BudgetSet, Cents, FinanceSnapshot, Transaction, TxInput } from './types';
import { httpApi } from './httpApi';

export interface FinanceApi {
  getSnapshot(): Promise<FinanceSnapshot>;
  createTransaction(input: TxInput, idempotencyKey: string): Promise<Transaction>;
  updateTransaction(id: string, input: TxInput): Promise<Transaction>;
  deleteTransaction(id: string): Promise<void>;
  createAccount(input: {
    name: string;
    group: AccountGroup;
    kind: Account['kind'];
    openingBalance: Cents;
  }): Promise<Account>;
  setBudget(month: string, patch: { total?: Cents; byCategory?: Record<string, Cents> }): Promise<BudgetSet>;
  repayLiability(
    id: string,
    input: { accountId: string; amount: Cents; date: string },
    idempotencyKey: string,
  ): Promise<void>;
  resetDemo?(): Promise<void>;
}

export const financeApi: FinanceApi = httpApi;
