import { ChevronRight } from 'lucide-react';
import { Link } from '../../router';
import { StackedBar } from '../../ui/charts';
import { Empty } from '../../ui/primitives';
import { useFinance } from '../../finance/FinanceContext';
import { GROUP_LABEL, GROUP_ORDER, currentMonth, daysUntil, overview, spendByCategory } from '../../finance/calc';
import { yuan } from '../../finance/money';
import { txIcon } from '../../finance/meta';

export function Overview() {
  const { snap, openQuickAdd } = useFinance();
  if (!snap) return null;
  const o = overview(snap);
  const month = currentMonth();
  const spent = spendByCategory(snap.transactions, month);
  const pct = Math.round(o.budgetUsed * 100);
  const hasBudget = snap.budget.total > 0;
  const over = o.budgetUsed > 1;
  const dueSoon = snap.liabilities.filter((l) => !l.paidThisPeriod).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const recent = snap.transactions.slice(0, 5);
  const catName = (id?: string) => snap.categories.find((c) => c.id === id)?.name ?? '';
  const accName = (id: string) => snap.accounts.find((a) => a.id === id)?.name ?? '';
  const topBudgets = (Object.entries(snap.budget.byCategory) as [string, number][])
    .map(([id, b]) => ({ id, b, s: spent[id] ?? 0 }))
    .sort((a, b) => (b.b > 0 ? b.s / b.b : b.s > 0 ? Number.MAX_VALUE : 0) - (a.b > 0 ? a.s / a.b : a.s > 0 ? Number.MAX_VALUE : 0))
    .slice(0, 4);

  return (
    <div className="stack-lg">
      <section className="hero card" aria-label="净资产">
        <p className="label">净资产</p>
        <p className="hero-num num">{yuan(o.net)}</p>
        <p className="muted num">
          资产 {yuan(o.total)} − 负债 {yuan(o.liabilities)}
        </p>
        <StackedBar parts={GROUP_ORDER.map((g) => ({ label: GROUP_LABEL[g], value: o[g] }))} />
      </section>

      <section className="stats card" aria-label="关键指标">
        <div>
          <p className="label">可支配余额</p>
          <p className="stat-num num">{yuan(o.disposable)}</p>
          <p className="hint">现金存款 − 30 天内到期还款，不含投资</p>
        </div>
        <div>
          <p className="label">本月收入</p>
          <p className="stat-num num">{yuan(o.income)}</p>
        </div>
        <div>
          <p className="label">本月支出</p>
          <p className="stat-num num">{yuan(o.expense)}</p>
        </div>
        <div>
          <p className="label">负债总额</p>
          <p className="stat-num num">{yuan(o.liabilities)}</p>
          <p className="hint">30 天内需还 {yuan(o.due30)}</p>
        </div>
      </section>

      <p className={`status-line ${!hasBudget || over ? 'warn' : 'ok'}`}>
        <i className="status-dot" />
        {!hasBudget ? '尚未设置本月预算' : over
          ? `本月已超出预算 ${yuan(o.expense - snap.budget.total)}`
          : `本月预算已使用 ${pct}%，还剩 ${yuan(snap.budget.total - o.expense)}`}
        ，本月结余 {yuan(o.balance, { sign: true })}
      </p>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2>预算进度</h2>
            <Link to="/finance/budget" className="link">全部 <ChevronRight size={14} /></Link>
          </div>
          {topBudgets.length === 0 && <Empty title="尚未设置分类预算" />}
          <ul className="progress-list">
            {topBudgets.map((r) => {
              const p = r.b > 0 ? Math.max(0, r.s / r.b) : r.s > 0 ? 1 : 0;
              const isOver = r.s > r.b;
              return (
                <li key={r.id}>
                  <div className="row-between">
                    <span>{catName(r.id)}{isOver && <em className="over-tag">超支</em>}</span>
                    <span className="muted num">{yuan(r.s)} / {yuan(r.b)}</span>
                  </div>
                  <div className={`track ${isOver ? 'over' : p >= 0.8 ? 'warn' : ''}`}><span style={{ width: `${Math.min(100, p * 100)}%` }} /></div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>即将还款</h2>
            <Link to="/finance/debts" className="link">全部 <ChevronRight size={14} /></Link>
          </div>
          {dueSoon.length === 0 ? (
            <Empty title="本期没有待还款项" />
          ) : (
            <ul className="list">
              {dueSoon.slice(0, 3).map((l) => {
                const days = daysUntil(l.dueDate);
                return (
                <li key={l.id} className="row">
                  <div className="row-main">
                    <p>{l.name}</p>
                    <p className="muted">{days < 0 ? `已逾期 ${-days} 天` : days === 0 ? '今天到期' : `${days} 天后到期`}</p>
                  </div>
                  <span className="num">{yuan(l.dueAmount)}</span>
                </li>
              ); })}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>最近明细</h2>
          <Link to="/finance/transactions" className="link">全部 <ChevronRight size={14} /></Link>
        </div>
        {recent.length === 0 ? (
          <Empty title="还没有记录" hint="记下第一笔，总览就会开始更新。" action={<button className="btn btn-primary" onClick={() => openQuickAdd()}>记一笔</button>} />
        ) : (
          <ul className="list">
            {recent.map((t) => {
              const I = txIcon(t);
              const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '-' : '';
              return (
                <li key={t.id}>
                  <button className="row row-btn" onClick={() => openQuickAdd(t)}>
                    <span className="ico"><I size={18} /></span>
                    <span className="row-main">
                      <span>{t.note || catName(t.categoryId) || '转账'}</span>
                      <span className="muted">{t.date.slice(5)}　{accName(t.accountId)}</span>
                    </span>
                    <span className={`num ${t.type === 'income' ? 'pos' : ''}`}>{sign}{yuan(t.amount)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
