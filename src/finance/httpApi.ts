import type { FinanceApi } from './api';

async function request<T>(path: string, method = 'GET', data?: unknown, key?: string): Promise<T> {
  const response = await fetch(`/api/finance${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (response.status === 204) return undefined as T;
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new Error('本地服务返回了无法读取的响应，请重试。'); }
  if (!response.ok) {
    const error = result as { error?: unknown };
    throw new Error(typeof error?.error === 'string' ? error.error : '操作失败，请重试。');
  }
  return result as T;
}

export const httpApi: FinanceApi = {
  getSnapshot: () => request('/snapshot'),
  createTransaction: (input, key) => request('/transactions', 'POST', input, key),
  updateTransaction: (id, input) => request(`/transactions/${encodeURIComponent(id)}`, 'PUT', input),
  deleteTransaction: (id) => request(`/transactions/${encodeURIComponent(id)}`, 'DELETE'),
  createAccount: (input) => request('/accounts', 'POST', input),
  setBudget: (month, patch) => request(`/budget/${encodeURIComponent(month)}`, 'PUT', patch),
  repayLiability: (id, input, key) => request(`/liabilities/${encodeURIComponent(id)}/repayments`, 'POST', input, key),
};
