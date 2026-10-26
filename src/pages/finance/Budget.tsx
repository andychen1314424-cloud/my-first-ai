import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { DevTag, Sheet } from '../../ui/primitives';
import { useToast } from '../../ui/toast';
import { useFinance } from '../../finance/FinanceContext';
import { avgEssentialMonthly, currentMonth, overview, shiftMonth, spendByCategory, sum, monthKey, expenseOf } from '../../finance/calc';
import { centsToInput, parseYuan, yuan } from '../../finance/money';

export function Budget() {
  const { snap, setBudget } = useFinance();
  const toast = useToast();
  const [edit, setEdit] = useState<{ id: string | 'total'; label: string } | null>(null);
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!snap) return null;

  const month = currentMonth();
  const o = overview(snap);
  const spent = spendByCategory(snap.transactions, month);
  const cats = snap.categories.filter((c) => c.kind === 'expense');
  const now = new Date();
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
  const catSum = sum(Object.values(snap.budget.byCategory));

  const open = (id: string | 'total', label: string) => {
    setEdit({ id, label });
    setVal(centsToInput(id === 'total' ? snap.budget.total : snap.budget.byCategory[id] ?? 0));
    setErr('');
  };
  const save = async () => {
    const c = parseYuan(val);
    if (c === null || c < 0) return setErr('请输入有效金额，最多两位小数');
    setBusy(true);
    try {
      await setBudget(edit!.id === 'total' ? { total: c } : { byCategory: { [edit!.id]: c } });
      toast(snap.isDemo ? '预算已更新（演示数据）' : '预算已保存到本地数据库');
      setEdit(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  // 下月预算建议：按近 3 个月各类别平均支出取整到 100 元（规则计算，不是 AI）
  const avg = (id: string) => {
    const months = [1, 2, 3].map((i) => shiftMonth(month, -i));
    const total = sum(snap.transactions.filter((t) => t.categoryId === id && months.includes(monthKey(t.date))).map(expenseOf));
    return Math.round(total / 3 / 10000) * 10000;
  };
  const suggestions = cats.map((c) => ({ c, s: avg(c.id) })).filter((x) => x.s > 0);
  const essential = avgEssentialMonthly(snap, month);

  return (
    <div className="stack-lg">
      <section className="card hero-sm">
        <div className="row-between">
          <p className="label">{month.replace('-', ' 年 ')} 月总预算</p>
          <button className="icon-btn" aria-label="调整总预算" onClick={() => open('total', '月度总预算')}><Pencil size={16} /></button>
        </div>
        <p className="hero-num-sm num">{yuan(o.expense)} <span className="muted of">/ {yuan(snap.budget.total)}</span></p>
        <div className={`track track-lg ${o.budgetUsed > 1 ? 'over' : o.budgetUsed >= 0.8 ? 'warn' : ''}`}><span style={{ width: `${Math.max(0, Math.min(100, o.budgetUsed * 100))}%` }} /></div>
        <p className="muted">
          {snap.budget.total <= 0 ? '尚未设置本月预算，请点击右上角调整。' : o.budgetUsed > 1 ? `已超支 ${yuan(o.expense - snap.budget.total)}` : `还剩 ${yuan(snap.budget.total - o.expense)}，本月还有 ${daysLeft} 天，日均可用 ${yuan(Math.max(0, Math.round((snap.budget.total - o.expense) / Math.max(1, daysLeft + 1))))}`}
        </p>
        {catSum !== snap.budget.total && <p className="hint">分类预算合计 {yuan(catSum)}，与总预算相差 {yuan(Math.abs(snap.budget.total - catSum))}。</p>}
      </section>

      <section>
        <h2 className="h2">分类预算</h2>
        <ul className="list card">
          {cats.map((c) => {
            const b = snap.budget.byCategory[c.id] ?? 0;
            const s = spent[c.id] ?? 0;
            const p = b > 0 ? Math.max(0, s / b) : 0;
            return (
              <li key={c.id} className="budget-row">
                <div className="row-between">
                  <span>{c.name}{b > 0 && p > 1 && <em className="over-tag">超支</em>}</span>
                  <span className="inline">
                    <span className="num muted">{yuan(s)} / {b > 0 ? yuan(b) : '未设置'}</span>
                    <button className="icon-btn" aria-label={`调整${c.name}预算`} onClick={() => open(c.id, `${c.name}预算`)}><Pencil size={15} /></button>
                  </span>
                </div>
                <div className={`track ${p > 1 ? 'over' : p >= 0.8 ? 'warn' : ''}`}><span style={{ width: `${Math.min(100, p * 100)}%` }} /></div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <div className="card-head"><h2>下月预算建议</h2><span className="tag tag-demo">规则计算</span></div>
        <p className="muted">按近 3 个月各类别平均支出取整，必要支出平均每月约 {yuan(essential)}。AI 个性化建议将在接入模型后提供。</p>
        <ul className="list">
          {suggestions.map(({ c, s }) => (
            <li key={c.id} className="row"><span className="row-main">{c.name}</span><span className="num">{yuan(s)}</span></li>
          ))}
          <li className="row row-total"><span className="row-main">建议总预算</span><span className="num">{yuan(sum(suggestions.map((x) => x.s)))}</span></li>
        </ul>
      </section>

      <section className="card">
        <div className="card-head"><h2>预算历史</h2><DevTag /></div>
        <p className="muted">需要后端按月保存预算快照后才能显示每月的预算执行情况。</p>
      </section>

      <Sheet
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.label ?? ''}
        footer={<><button className="btn" onClick={() => setEdit(null)}>取消</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '保存中…' : '保存'}</button></>}
      >
        <label className="field">
          <span className="label">每月预算（元）</span>
          <input className="input" inputMode="decimal" autoFocus value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </label>
        {err && <p className="field-error" role="alert">{err}</p>}
      </Sheet>
    </div>
  );
}
