import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { financeApi } from './api';
import { useToast } from '../ui/toast';
import type { FinanceSnapshot, Transaction, TxInput } from './types';

type Status = 'loading' | 'ready' | 'error';

interface Ctx {
  snap: FinanceSnapshot | null;
  status: Status;
  error: string;
  reload: () => Promise<void>;
  createTx: (input: TxInput, key: string) => Promise<Transaction>;
  updateTx: (id: string, input: TxInput) => Promise<void>;
  deleteTx: (id: string) => Promise<void>;
  createAccount: typeof financeApi.createAccount;
  setBudget: (patch: { total?: number; byCategory?: Record<string, number> }) => Promise<void>;
  repay: (id: string, input: { accountId: string; amount: number; date: string }, key: string) => Promise<void>;
  resetDemo: () => Promise<void>;
  // 快速记账抽屉
  quick: { open: boolean; editing?: Transaction };
  openQuickAdd: (editing?: Transaction) => void;
  closeQuickAdd: () => void;
}

const C = createContext<Ctx | null>(null);
export const useFinance = () => {
  const v = useContext(C);
  if (!v) throw new Error('useFinance 必须在 FinanceProvider 内使用');
  return v;
};

export function FinanceProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [snap, setSnap] = useState<FinanceSnapshot | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [quick, setQuick] = useState<Ctx['quick']>({ open: false });

  const reload = useCallback(async () => {
    try {
      setStatus((s) => (s === 'ready' ? s : 'loading'));
      setSnap(await financeApi.getSnapshot());
      setStatus('ready');
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取财务数据');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<Ctx>(
    () => ({
      snap,
      status,
      error,
      reload,
      createTx: async (input, key) => {
        const t = await financeApi.createTransaction(input, key);
        await reload();
        return t;
      },
      updateTx: async (id, input) => {
        await financeApi.updateTransaction(id, input);
        await reload();
      },
      deleteTx: async (id) => {
        await financeApi.deleteTransaction(id);
        await reload();
      },
      createAccount: async (input) => {
        const a = await financeApi.createAccount(input);
        await reload();
        return a;
      },
      setBudget: async (patch) => {
        await financeApi.setBudget(snap?.budget.month ?? '', patch);
        await reload();
      },
      repay: async (id, input, key) => {
        await financeApi.repayLiability(id, input, key);
        await reload();
      },
      resetDemo: async () => {
        if (!snap?.isDemo || !financeApi.resetDemo) throw new Error('真实账本不能通过演示重置清空。');
        await financeApi.resetDemo();
        await reload();
      },
      quick,
      openQuickAdd: (editing) => {
        if (editing && !['expense', 'income', 'transfer'].includes(editing.type)) {
          toast('这类记录的编辑界面尚未开放，原记录已保留。');
          return;
        }
        setQuick({ open: true, editing });
      },
      closeQuickAdd: () => setQuick({ open: false }),
    }),
    [snap, status, error, reload, quick, toast],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}
