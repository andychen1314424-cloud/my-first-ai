import { useState } from 'react';
import { Plus } from 'lucide-react';
import { DevTag, Sheet } from '../../ui/primitives';
import { useToast } from '../../ui/toast';
import { useFinance } from '../../finance/FinanceContext';
import { GROUP_LABEL, GROUP_ORDER, balances, sum } from '../../finance/calc';
import { parseYuan, yuan } from '../../finance/money';
import { accountIcon } from '../../finance/meta';
import type { Account, AccountGroup } from '../../finance/types';

const KINDS: { value: Account['kind']; label: string; group: AccountGroup }[] = [
  { value: 'bank', label: '银行卡', group: 'cash' },
  { value: 'alipay', label: '支付宝', group: 'cash' },
  { value: 'wechat', label: '微信', group: 'cash' },
  { value: 'cash', label: '现金', group: 'cash' },
  { value: 'fund', label: '基金账户', group: 'investment' },
  { value: 'stock', label: '股票账户', group: 'investment' },
  { value: 'other', label: '其他资产', group: 'fixed' },
];

export function Assets() {
  const { snap, createAccount } = useFinance();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Account['kind']>('bank');
  const [bal, setBal] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!snap) return null;
  const b = balances(snap.accounts);

  const submit = async () => {
    const cents = bal.trim() === '' ? 0 : parseYuan(bal);
    if (!name.trim()) return setErr('请填写账户名称');
    if (cents === null) return setErr('初始余额格式不正确，最多两位小数');
    setBusy(true);
    try {
      const k = KINDS.find((x) => x.value === kind)!;
      await createAccount({ name: name.trim(), group: k.group, kind, openingBalance: cents });
      toast(snap.isDemo ? '已添加账户（演示数据）' : '账户已保存到本地数据库');
      setOpen(false);
      setName('');
      setBal('');
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '添加失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      <section className="card hero-sm">
        <p className="label">总资产</p>
        <p className="hero-num-sm num">{yuan(b.total)}</p>
        <p className="hint">可支配资金不等于总资产：投资、公积金等不能直接用来支付日常开销。</p>
      </section>

      <div className="row-between">
        <h2 className="h2">账户</h2>
        <div className="inline">
          <button className="btn" disabled title="开发中">
            对账 <DevTag />
          </button>
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> 添加账户
          </button>
        </div>
      </div>

      {GROUP_ORDER.map((g) => {
        const items = snap.accounts.filter((a) => a.group === g);
        if (items.length === 0) return null;
        return (
          <section key={g} className="group">
            <div className="group-head">
              <h3>{GROUP_LABEL[g]}</h3>
              <span className="num muted">{yuan(sum(items.map((a) => a.balance)))}</span>
            </div>
            <ul className="list card">
              {items.map((a) => {
                const I = accountIcon(a.kind);
                return (
                  <li key={a.id} className="row">
                    <span className="ico"><I size={18} /></span>
                    <span className="row-main"><span>{a.name}</span></span>
                    <span className="num">{yuan(a.balance)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="添加账户"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>取消</button>
            <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? '保存中…' : '添加'}</button>
          </>
        }
      >
        <div className="stack">
          <label className="field">
            <span className="label">账户类型</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Account['kind'])}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label">名称</span>
            <input className="input" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="例如：工资卡" />
          </label>
          <label className="field">
            <span className="label">初始余额（元）</span>
            <input className="input" inputMode="decimal" value={bal} onChange={(e) => setBal(e.target.value)} placeholder="0.00" />
          </label>
          {err && <p className="field-error" role="alert">{err}</p>}
        </div>
      </Sheet>
    </div>
  );
}
