import type { Cents } from './types';

const fmt = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });

export function yuan(c: Cents, opts: { sign?: boolean; compact?: boolean } = {}): string {
  if (!Number.isSafeInteger(c)) return '—';
  const abs = Math.abs(c) / 100;
  const [integer, fraction] = centsToDecimal(Math.abs(c)).split('.');
  const body = opts.compact && abs >= 10000 ? `${fmt.format(abs / 10000)}万` : `${fmt0.format(BigInt(integer))}.${fraction}`;
  const sign = c < 0 ? '-' : opts.sign && c > 0 ? '+' : '';
  return `${sign}¥${body}`;
}

export function yuanInt(c: Cents): string {
  if (!Number.isSafeInteger(c)) return '—';
  return `¥${fmt0.format((BigInt(Math.abs(c)) + 50n) / 100n)}`;
}

/** 解析用户输入的金额（元，最多两位小数）。无效返回 null。 */
export function parseYuan(input: string): Cents | null {
  const s = input.trim().replace(/[,，¥￥\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [i, d = ''] = s.split('.');
  const cents = BigInt(i) * 100n + BigInt((d + '00').slice(0, 2));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

/** Exact fixed-point decimal, also used by exports. No division through floats. */
export function centsToDecimal(c: Cents): string {
  if (!Number.isSafeInteger(c)) return '—';
  const value = BigInt(c);
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

export function centsToInput(c: Cents): string {
  return centsToDecimal(c).replace(/\.00$/, '');
}
