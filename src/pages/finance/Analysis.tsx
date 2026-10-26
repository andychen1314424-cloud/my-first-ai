import { useMemo, useState } from 'react';
import { DevTag, Segmented } from '../../ui/primitives';
import { HBars, StackedBar, TrendBars } from '../../ui/charts';
import { useFinance } from '../../finance/FinanceContext';
import { GROUP_LABEL, GROUP_ORDER, avgEssentialMonthly, balances, currentMonth, hasEssentialHistory, monthlyTrend, runway, spendByCategory, upcomingDue, type RunwayMode } from '../../finance/calc';
import { centsToInput, parseYuan, yuan } from '../../finance/money';

export function Analysis() {
  const { snap } = useFinance();
  const month = currentMonth();
  const [mode, setMode] = useState<RunwayMode>('normal');
  const [reserve, setReserve] = useState(3);
  const [essentialInput, setEssentialInput] = useState<string | null>(null);

  const data = useMemo(() => {
    if (!snap) return null;
    const spent = spendByCategory(snap.transactions, month);
    const rows = Object.entries(spent)
      .map(([id, value]) => ({ id, value, label: snap.categories.find((c) => c.id === id)?.name ?? id }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
    return { rows, trend: monthlyTrend(snap.transactions, month), bal: balances(snap.accounts), due: upcomingDue(snap.liabilities), essential: avgEssentialMonthly(snap, month), hasHistory: hasEssentialHistory(snap, month) };
  }, [snap, month]);

  if (!snap || !data) return null;
  const essentialCents = essentialInput === null ? (data.hasHistory ? data.essential : null) : parseYuan(essentialInput);
  const essentialErr = essentialInput !== null && (essentialCents === null || essentialCents <= 0) ? '请输入大于 0 的金额' : '';
  const r = runway({ liquid: data.bal.cash, upcomingBills: data.due, monthlyEssential: essentialCents ?? 0, reserveMonths: reserve, mode });

  return (
    <div className="stack-lg">
      <section className="card">
        <div className="card-head"><h2>资金可支撑多久</h2></div>
        <p className="muted">假设之后没有任何收入，只靠现金及银行存款，大约能撑多久。</p>
        <Segmented label="模拟模式" value={mode} onChange={setMode} options={[{ value: 'frugal', label: '节约' }, { value: 'normal', label: '正常' }, { value: 'relaxed', label: '宽松' }]} />
        <p className="runway-num num">{r.months !== null ? r.months.toFixed(1) : '—'}<span> 个月</span></p>
        <dl className="kv kv-col">
          <div><dt>当前流动资金</dt><dd className="num">{yuan(data.bal.cash)}</dd></div>
          <div><dt>未来 30 天确定性账单</dt><dd className="num">− {yuan(data.due)}</dd></div>
          <div><dt>可动用资金</dt><dd className="num">{yuan(r.usable)}</dd></div>
          <div><dt>每月支出（{mode === 'frugal' ? '节约' : mode === 'normal' ? '正常' : '宽松'}）</dt><dd className="num">{r.canEstimate ? yuan(r.monthlySpend) : '—'}</dd></div>
        </dl>
        <div className="calc-inputs">
          <label className="field">
            <span className="label">必要月支出（元）</span>
            <input className="input" inputMode="decimal" placeholder="请输入必要月支出" value={essentialInput ?? (data.hasHistory ? centsToInput(data.essential) : '')} onChange={(e) => setEssentialInput(e.target.value)} aria-invalid={!!essentialErr} />
            <span className="hint">{data.hasHistory ? '默认取近 3 个月的必要支出平均值' : '近 3 个月必要支出记录不足，请手动填写估计值'}</span>
            {essentialErr && <span className="field-error">{essentialErr}</span>}
          </label>
          <label className="field">
            <span className="label">应急储备目标</span>
            <select className="input" value={reserve} onChange={(e) => setReserve(Number(e.target.value))}>
              {[3, 6, 12].map((n) => <option key={n} value={n}>{n} 个月支出（{r.canEstimate ? yuan(r.monthlySpend * n) : '待填写月支出'}）</option>)}
            </select>
          </label>
        </div>
        <p className={`status-line ${r.reserveOk ? 'ok' : 'warn'}`}><i className="status-dot" />{!r.canEstimate ? '无法估算，请输入有效的必要月支出。' : r.reserveOk ? `可动用资金已覆盖 ${reserve} 个月的应急储备` : `可动用资金低于 ${reserve} 个月的应急储备目标，差 ${yuan(r.reserveTarget - r.usable)}`}</p>
        <details className="assume">
          <summary>计算假设</summary>
          <ul>{r.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        </details>
      </section>

      <div className="two-col">
        <section className="card">
          <div className="card-head"><h2>本月支出分类</h2></div>
          {data.rows.length ? <HBars rows={data.rows} /> : <p className="muted">本月还没有支出。</p>}
        </section>
        <section className="card">
          <div className="card-head"><h2>资产构成</h2></div>
          <StackedBar parts={GROUP_ORDER.map((g) => ({ label: GROUP_LABEL[g], value: data.bal[g] }))} />
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>近六个月收支</h2>
          <span className="legend-inline"><i className="dot bar-income-dot" />收入<i className="dot bar-expense-dot" />支出</span>
        </div>
        <TrendBars data={data.trend} />
      </section>

      <section className="card">
        <div className="card-head"><h2>财务报告</h2><DevTag /></div>
        <p className="muted">日报、周报、月报将在后端接入后生成，包含收支、资产与负债变化、预算执行和风险提醒。目前可在「明细」页导出 CSV。</p>
      </section>
    </div>
  );
}
