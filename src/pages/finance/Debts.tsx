import { useState } from 'react';
import { DevTag, Sheet } from '../../ui/primitives';
import { useToast } from '../../ui/toast';
import { useFinance } from '../../finance/FinanceContext';
import { daysUntil, sum, todayStr } from '../../finance/calc';
import { centsToInput, parseYuan, yuan } from '../../finance/money';
import type { Liability } from '../../finance/types';

export function Debts() {
  const { snap, repay } = useFinance();
  const toast = useToast();
  const [target, setTarget] = useState<Liability | null>(null);
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState('');
  if (!snap) return null;

  const cash = snap.accounts.filter((a) => a.group === 'cash');
  const total = sum(snap.liabilities.map((l) => l.balance));

  const open = (l: Liability) => {
    setTarget(l);
    setAmount(centsToInput(Math.min(l.dueAmount, l.balance)));
    setAccountId(cash[0]?.id ?? '');
    setErr('');
    setKey(crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  };
  const submit = async () => {
    if (!target || busy) return;
    const c = parseYuan(amount);
    const acc = cash.find((a) => a.id === accountId);
    if (c === null || c <= 0) return setErr('请输入大于 0 的还款金额');
    if (c > target.balance) return setErr('还款金额不能超过当前余额');
    if (!acc) return setErr('请选择还款账户');
    if (c > acc.balance) return setErr(`${acc.name}余额不足`);
    setBusy(true);
    try {
      await repay(target.id, { accountId, amount: c, date: todayStr() }, key);
      toast(`已还款 ${yuan(c)}${snap.isDemo ? '（演示数据）' : ''}`);
      setTarget(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '还款失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      <section className="card hero-sm">
        <p className="label">负债总额</p>
        <p className="hero-num-sm num">{yuan(total)}</p>
        <p className="hint">还款只减少现金账户和负债余额，不会被计入消费支出。</p>
      </section>

      <div className="row-between">
        <h2 className="h2">全部负债</h2>
        <button className="btn" disabled title="开发中">新增负债 <DevTag /></button>
      </div>

      <ul className="stack">
        {snap.liabilities.map((l) => {
          const d = daysUntil(l.dueDate);
          const paid = l.paidThisPeriod || l.balance === 0;
          return (
            <li key={l.id} className="card debt">
              <div className="row-between">
                <h3>{l.name}</h3>
                <span className={`status-pill ${paid ? 'done' : d <= 7 ? 'soon' : ''}`}>{paid ? '本期已还' : d <= 0 ? '今天到期' : `${d} 天后到期`}</span>
              </div>
              <p className="debt-num num">{yuan(l.balance)}</p>
              <dl className="kv">
                <div><dt>本期应还</dt><dd className="num">{yuan(l.dueAmount)}</dd></div>
                <div><dt>到期日</dt><dd>{l.dueDate.slice(5).replace('-', ' 月 ')} 日</dd></div>
                <div><dt>年化利率</dt><dd>{l.annualRate === undefined ? '—' : `${(l.annualRate * 100).toFixed(2)}%`}</dd></div>
              </dl>
              <button className="btn" onClick={() => open(l)} disabled={l.balance === 0}>还款</button>
            </li>
          );
        })}
      </ul>

      <Sheet
        open={!!target}
        onClose={() => setTarget(null)}
        title={target ? `还款：${target.name}` : ''}
        footer={<><button className="btn" onClick={() => setTarget(null)} disabled={busy}>取消</button><button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? '处理中…' : '确认还款'}</button></>}
      >
        <div className="stack">
          <label className="field">
            <span className="label">还款账户</span>
            <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {cash.map((a) => <option key={a.id} value={a.id}>{a.name}（{yuan(a.balance)}）</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label">还款金额（元）</span>
            <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <p className="hint">确认后，所选账户余额与该负债余额会同时减少。</p>
          {err && <p className="field-error" role="alert">{err}</p>}
        </div>
      </Sheet>
    </div>
  );
}
