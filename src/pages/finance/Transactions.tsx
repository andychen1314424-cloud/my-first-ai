import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { Empty, Segmented } from '../../ui/primitives';
import { useFinance } from '../../finance/FinanceContext';
import { currentMonth, expenseOf, incomeOf, monthKey, shiftMonth, sum } from '../../finance/calc';
import { centsToDecimal, yuan } from '../../finance/money';
import { TYPE_LABEL, txIcon } from '../../finance/meta';

type Filter = 'all' | 'expense' | 'income' | 'transfer';

export function Transactions() {
  const { snap, openQuickAdd } = useFinance();
  const [month, setMonth] = useState(currentMonth());
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const accName = (id?: string) => snap?.accounts.find((a) => a.id === id)?.name ?? '';
  const catName = (id?: string) => snap?.categories.find((c) => c.id === id)?.name ?? '';

  const inMonth = useMemo(() => (snap?.transactions ?? []).filter((t) => monthKey(t.date) === month), [snap, month]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inMonth.filter((t) => {
      if (filter === 'expense' && !['expense', 'refund'].includes(t.type)) return false;
      if (filter === 'income' && t.type !== 'income') return false;
      if (filter === 'transfer' && !['transfer', 'repay'].includes(t.type)) return false;
      if (!needle) return true;
      return `${t.note} ${catName(t.categoryId)} ${accName(t.accountId)}`.toLowerCase().includes(needle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inMonth, filter, q, snap]);

  const groups = useMemo(() => {
    const m = new Map<string, typeof list>();
    list.forEach((t) => m.set(t.date, [...(m.get(t.date) ?? []), t]));
    return [...m.entries()];
  }, [list]);

  if (!snap) return null;
  const income = sum(inMonth.map(incomeOf));
  const expense = sum(inMonth.map(expenseOf));

  const exportCsv = () => {
    const esc = (s: string) => `"${(/^[\s]*[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`;
    const rows = [['日期', '类型', '金额(元)', '类别', '账户', '转入账户', '备注', '来源'], ...list.map((t) => [t.date, TYPE_LABEL[t.type] ?? t.type, centsToDecimal(t.amount), catName(t.categoryId), accName(t.accountId), accName(t.toAccountId), t.note, t.source])];
    const csv = '\ufeff' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `zx-finance${snap.isDemo ? '-demo' : ''}-${month}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div className="month-nav">
          <button className="icon-btn" aria-label="上个月" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={18} /></button>
          <strong>{month.replace('-', ' 年 ')} 月</strong>
          <button className="icon-btn" aria-label="下个月" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= currentMonth()}><ChevronRight size={18} /></button>
        </div>
        <button className="btn" onClick={exportCsv} disabled={list.length === 0}>
          <Download size={16} /> 导出 CSV
        </button>
      </div>

      <section className="stats stats-2 card">
        <div><p className="label">收入</p><p className="stat-num num">{yuan(income)}</p></div>
        <div><p className="label">支出</p><p className="stat-num num">{yuan(expense)}</p></div>
      </section>

      <div className="filters">
        <Segmented label="筛选类型" value={filter} onChange={setFilter} options={[{ value: 'all', label: '全部' }, { value: 'expense', label: '支出' }, { value: 'income', label: '收入' }, { value: 'transfer', label: '转账与还款' }]} />
        <label className="search">
          <Search size={16} aria-hidden />
          <input placeholder="搜索备注、类别、账户" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜索明细" />
        </label>
      </div>

      {groups.length === 0 ? (
        <Empty title={q || filter !== 'all' ? '没有符合条件的记录' : '这个月还没有记录'} hint={q || filter !== 'all' ? '换个关键词或筛选条件试试。' : undefined} action={<button className="btn btn-primary" onClick={() => openQuickAdd()}>记一笔</button>} />
      ) : (
        groups.map(([date, items]) => (
          <section key={date} className="group">
            <div className="group-head">
              <h3>{date.slice(5).replace('-', ' 月 ')} 日</h3>
              <span className="muted num">支出 {yuan(sum(items.map(expenseOf)))}</span>
            </div>
            <ul className="list card">
              {items.map((t) => {
                const I = txIcon(t);
                const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '-' : t.type === 'refund' ? '+' : '';
                return (
                  <li key={t.id}>
                    <button className="row row-btn" onClick={() => t.type === 'repay' ? undefined : openQuickAdd(t)} disabled={t.type === 'repay'} title={t.type === 'repay' ? '还款记录请在负债页管理' : undefined}>
                      <span className="ico"><I size={18} /></span>
                      <span className="row-main">
                        <span>{t.note || catName(t.categoryId) || TYPE_LABEL[t.type]}</span>
                        <span className="muted">
                          {t.type === 'transfer' ? `${accName(t.accountId)} → ${accName(t.toAccountId)}` : `${catName(t.categoryId) || TYPE_LABEL[t.type]}　${accName(t.accountId)}`}
                        </span>
                      </span>
                      <span className={`num ${t.type === 'income' || t.type === 'refund' ? 'pos' : ''}`}>{sign}{yuan(t.amount)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
