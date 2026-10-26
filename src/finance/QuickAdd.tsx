import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Sparkles, Trash2 } from 'lucide-react';
import { ConfirmDialog, Segmented, Sheet, DemoTag } from '../ui/primitives';
import { useToast } from '../ui/toast';
import { useFinance } from './FinanceContext';
import { centsToInput, parseYuan, yuan } from './money';
import { parseEntry } from './nlParse';
import { todayStr } from './calc';
import type { TxInput, TxType } from './types';
import { navigate } from '../router';

type Kind = 'expense' | 'income' | 'transfer';
const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'transfer', label: '转账' },
];
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `k_${Date.now()}_${Math.random()}`);

/** 三步记账：1 金额 → 2 类别与账户 → 3 确认保存 */
export function QuickAddHost() {
  const { quick, closeQuickAdd } = useFinance();
  // 每次打开都重新挂载，确保表单状态与幂等键是全新的
  return quick.open ? <QuickAddSheet key={quick.editing?.id ?? 'new'} onClose={closeQuickAdd} /> : null;
}

function QuickAddSheet({ onClose }: { onClose: () => void }) {
  const { snap, quick, createTx, updateTx, deleteTx } = useFinance();
  const toast = useToast();
  const editing = quick.editing;
  const key = useRef(newKey()).current;

  const accounts = snap?.accounts ?? [];
  const payable = accounts.filter((a) => a.group === 'cash');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [kind, setKind] = useState<Kind>((editing && ['expense', 'income', 'transfer'].includes(editing.type) ? editing.type : 'expense') as Kind);
  const [amount, setAmount] = useState(editing ? centsToInput(editing.amount) : '');
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? '');
  const [accountId, setAccountId] = useState(editing?.accountId ?? payable[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState(editing?.toAccountId ?? '');
  const [date, setDate] = useState(editing?.date ?? todayStr());
  const [note, setNote] = useState(editing?.note ?? '');
  const [nl, setNl] = useState('');
  const [nlHint, setNlHint] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 1) amountRef.current?.focus();
  }, [step]);

  const cats = useMemo(() => (snap?.categories ?? []).filter((c) => c.kind === (kind === 'income' ? 'income' : 'expense')), [snap, kind]);
  const cents = parseYuan(amount);
  const amountError = amount !== '' && (cents === null || cents <= 0) ? '请输入大于 0 的金额，最多两位小数' : '';

  const step1Ok = cents !== null && cents > 0;
  const validAccount = payable.some((a) => a.id === accountId);
  const step2Ok = kind === 'transfer' ? validAccount && payable.some((a) => a.id === toAccountId) && accountId !== toAccountId : cats.some((c) => c.id === categoryId) && validAccount;
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '—';
  const catName = (id: string) => snap?.categories.find((c) => c.id === id)?.name ?? '—';

  const changeKind = (k: Kind) => {
    setKind(k);
    setCategoryId('');
    setError('');
  };

  const parse = () => {
    const p = parseEntry(nl, accounts, snap?.categories ?? []);
    if (p.type !== 'income' && p.type !== 'expense') {
      setNlHint('这类交易无法用当前关键词规则可靠识别，请手动选择类型并填写金额、类别与账户。转账请手动选择两个账户；投资、借贷、还款和退款暂不支持在此新增。');
      return;
    }
    if (!p.amount) {
      setAmount('');
      setNlHint('没有识别到有效金额，请直接输入大于 0、最多两位小数的金额。');
      return;
    }
    const k: Kind = p.type === 'income' ? 'income' : 'expense';
    setKind(k);
    setAmount(centsToInput(p.amount));
    setCategoryId(p.categoryId ?? '');
    setAccountId(payable.some((a) => a.id === p.accountId) ? p.accountId! : '');
    if (p.date) setDate(p.date);
    setNote(p.note);
    setNlHint(p.missing.length ? `还缺少：${p.missing.join('、')}，请在下一步补充。` : '已识别，请确认后保存。');
    setStep(p.missing.length ? 2 : 3);
  };

  const buildInput = (): TxInput => ({
    type: kind as TxType,
    amount: cents ?? 0,
    date,
    accountId,
    toAccountId: kind === 'transfer' ? toAccountId : undefined,
    categoryId: kind === 'transfer' ? undefined : categoryId,
    note: note.trim(),
    source: 'manual',
  });

  const save = async () => {
    if (saving) return; // 防止重复提交
    if (!step1Ok || !step2Ok) return setError('请先完成前两步');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('请选择有效日期');
    setSaving(true);
    setError('');
    try {
      if (editing) await updateTx(editing.id, buildInput());
      else await createTx(buildInput(), key);
      toast(editing ? '已保存修改' : snap?.isDemo ? '已记一笔（演示数据）' : '已保存到本地数据库');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试');
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await deleteTx(editing.id);
      toast('已删除');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
      setSaving(false);
      setConfirmDel(false);
    }
  };

  const next = () => {
    if (step === 1 && step1Ok) setStep(2);
    else if (step === 2 && step2Ok) setStep(3);
  };

  const footer = (
    <>
      {step > 1 ? (
        <button className="btn" onClick={() => setStep((s) => (s - 1) as 1 | 2)} disabled={saving}>
          <ArrowLeft size={16} /> 上一步
        </button>
      ) : (
        <button className="btn" onClick={onClose}>
          取消
        </button>
      )}
      {step < 3 ? (
        <button className="btn btn-primary" onClick={next} disabled={step === 1 ? !step1Ok : !step2Ok}>
          下一步
        </button>
      ) : (
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? '保存中…' : editing ? '保存修改' : '保存'}
        </button>
      )}
    </>
  );

  return (
    <>
      <Sheet open onClose={confirmDel ? () => setConfirmDel(false) : onClose} title={editing ? '编辑记录' : '记一笔'} footer={footer}>
        <div className="steps" aria-label={`第 ${step} 步，共 3 步`}>
          {[1, 2, 3].map((n) => (
            <span key={n} className={n <= step ? 'on' : ''} />
          ))}
          <em>{step} / 3</em>
          {snap?.isDemo && <DemoTag label="演示模式" />}
        </div>
        {step > 1 && nlHint && <p className="hint" role="status">{nlHint}</p>}

        {step === 1 && (
          <div className="stack">
            <Segmented label="记账类型" value={kind} onChange={changeKind} options={KIND_OPTIONS} />
            <label className="amount-field">
              <span className="muted">金额（元）</span>
              <input
                ref={amountRef}
                className="amount-input"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && next()}
                aria-invalid={!!amountError}
              />
              {amountError && <span className="field-error">{amountError}</span>}
            </label>
            {payable.length === 0 && (
              <div className="banner" role="note">
                <div><p>先添加一个账户，再开始记账。</p><button className="btn" onClick={() => { onClose(); navigate('/finance/assets'); }}>添加账户</button></div>
              </div>
            )}
            {!editing && payable.length > 0 && (
              <div className="nl">
                <label htmlFor="nl" className="muted nl-label">
                  <Sparkles size={14} /> 或用一句话记账
                </label>
                <div className="nl-row">
                  <input id="nl" className="input" placeholder="例如：午饭 38 微信" value={nl} onChange={(e) => setNl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && parse()} />
                  <button className="btn" onClick={parse} disabled={!nl.trim()}>
                    识别
                  </button>
                </div>
                <p className="hint">{nlHint || '关键词规则提案，并非 AI。识别后仍需你确认才会保存。'}</p>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="stack">
            {kind !== 'transfer' ? (
              <>
                <div>
                  <p className="label">类别</p>
                  <div className="chips" role="radiogroup" aria-label="类别">
                    {cats.map((c) => (
                      <button key={c.id} role="radio" aria-checked={categoryId === c.id} className={`chip ${categoryId === c.id ? 'on' : ''}`} onClick={() => setCategoryId(c.id)}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="field">
                  <span className="label">{kind === 'income' ? '收款账户' : '支付账户'}</span>
                  <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                    <option value="">请选择</option>
                    {payable.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  <span className="label">转出账户</span>
                  <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                    <option value="">请选择</option>
                    {payable.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="label">转入账户</span>
                  <select className="input" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                    <option value="">请选择</option>
                    {payable.map((a) => (
                      <option key={a.id} value={a.id} disabled={a.id === accountId}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="hint">转账只在账户之间移动资金，不计入收入或支出。</p>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="stack">
            <div className="summary">
              <div className="summary-amount">{kind === 'income' ? '+' : kind === 'expense' ? '-' : ''}{yuan(cents ?? 0)}</div>
              <dl>
                <div><dt>类型</dt><dd>{KIND_OPTIONS.find((o) => o.value === kind)?.label}</dd></div>
                {kind !== 'transfer' && <div><dt>类别</dt><dd>{catName(categoryId)}</dd></div>}
                <div><dt>{kind === 'transfer' ? '转出' : '账户'}</dt><dd>{accName(accountId)}</dd></div>
                {kind === 'transfer' && <div><dt>转入</dt><dd>{accName(toAccountId)}</dd></div>}
              </dl>
            </div>
            <label className="field">
              <span className="label">日期</span>
              <input className="input" type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">备注（可选）</span>
              <input className="input" value={note} maxLength={40} onChange={(e) => setNote(e.target.value)} placeholder="例如：午饭" />
            </label>
            {editing && (
              <button className="btn btn-quiet-danger" onClick={() => setConfirmDel(true)} disabled={saving}>
                <Trash2 size={16} /> 删除这笔记录
              </button>
            )}
          </div>
        )}
        {error && <p className="field-error" role="alert">{error}</p>}
      </Sheet>
      <ConfirmDialog
        open={confirmDel}
        title="删除这笔记录？"
        message="删除后，相关账户余额会同步回退。此操作无法撤销。"
        confirmLabel="删除"
        danger
        busy={saving}
        onConfirm={remove}
        onClose={() => setConfirmDel(false)}
      />
    </>
  );
}
