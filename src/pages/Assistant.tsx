import { useEffect, useRef, useState } from 'react';
import { ArrowUp, History as HistoryIcon, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog, DemoTag } from '../ui/primitives';
import { useAssistant, type Conversation } from '../assistant/AssistantContext';
import { useFinance } from '../finance/FinanceContext';
import { RUNWAY_FACTOR, avgEssentialMonthly, currentMonth, daysUntil, expenseOf, hasEssentialHistory, overview, runway, sum, todayStr, upcomingDue, balances } from '../finance/calc';
import { yuan } from '../finance/money';
import type { FinanceSnapshot } from '../finance/types';

const SUGGESTIONS = ['我这个月花了多少钱？', '我还有多少负债？', '最近 30 天哪类消费最多？', '如果下个月没有收入，还能支撑多久？'];

/** 演示回复：数字来自确定性计算（与财务页一致），措辞是固定模板，不是模型生成。 */
function demoReply(q: string, snap: FinanceSnapshot | null): string {
  const fallback = '这是演示回复，Qwen3 尚未连接。接入后，这里会由模型理解你的问题，所有金额仍由程序从账本中查询，不会由模型自己计算。';
  if (!snap) return fallback;
  const o = overview(snap);
  if (/花了多少|支出多少|本月支出/.test(q)) {
    return `本月支出 ${yuan(o.expense)}，收入 ${yuan(o.income)}，结余 ${yuan(o.balance, { sign: true })}。${snap.budget.total > 0 ? `预算已使用 ${Math.round(o.budgetUsed * 100)}%。` : '尚未设置本月预算。'}`;
  }
  if (/负债|欠/.test(q)) {
    const soon = snap.liabilities.filter((l) => !l.paidThisPeriod && daysUntil(l.dueDate) <= 30);
    return `当前负债共 ${yuan(o.liabilities)}，其中 30 天内需还款 ${yuan(o.due30)}（${soon.length} 笔）。`;
  }
  if (/30\s*天|哪类|最多/.test(q)) {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const from = since.toISOString().slice(0, 10);
    const by = new Map<string, number>();
    snap.transactions.filter((t) => t.date >= from && t.date <= todayStr()).forEach((t) => {
      const e = expenseOf(t);
      if (e && t.categoryId) by.set(t.categoryId, (by.get(t.categoryId) ?? 0) + e);
    });
    const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const total = sum([...by.values()]);
    return top.length ? `最近 30 天支出 ${yuan(total)}。最多的三类：${top.map(([id, v]) => `${snap.categories.find((c) => c.id === id)?.name} ${yuan(v)}`).join('、')}。` : '最近 30 天没有支出记录。';
  }
  if (/没有收入|撑多久|支撑/.test(q)) {
    if (!hasEssentialHistory(snap, currentMonth())) return '近 3 个月没有足够的必要支出记录，暂时无法估算资金可支撑多久。请在「财务 → 分析」填写必要月支出后查看估算。';
    const r = runway({ liquid: balances(snap.accounts).cash, upcomingBills: upcomingDue(snap.liabilities), monthlyEssential: avgEssentialMonthly(snap, currentMonth()), reserveMonths: 3, mode: 'normal' });
    if (r.months === null) return '目前没有足够的有效必要支出，无法估算资金可支撑多久。请在「财务 → 分析」填写大于 0 的必要月支出。';
    return `按正常模式（必要支出 ${Math.round(RUNWAY_FACTOR.normal * 100)}%）约可支撑 ${r.months.toFixed(1)} 个月：可动用资金 ${yuan(r.usable)}，每月支出 ${yuan(r.monthlySpend)}。假设无收入，且只动用现金存款。详细假设见「财务 → 分析」。`;
  }
  return fallback;
}

function Bubbles({ c, pending }: { c: Conversation; pending: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [c.messages.length, pending]);
  return (
    <div className="messages" role="log" aria-live="polite">
      {c.messages.map((m) => (
        <div key={m.id} className={`msg ${m.role}`}>
          <div className="bubble">{m.text}</div>
          {m.role === 'assistant' && m.demo && <DemoTag label="演示回复" />}
        </div>
      ))}
      {pending && (
        <div className="msg assistant" aria-label="正在回复">
          <div className="bubble typing"><i /><i /><i /></div>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

export function AssistantPage() {
  const { conversations, active, setActive, newChat, append, remove } = useAssistant();
  const { snap } = useFinance();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [del, setDel] = useState<Conversation | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const send = (value = text) => {
    const v = value.trim();
    if (!v || pending) return;
    const id = active.id;
    append(id, { id: `m_${Date.now()}`, role: 'user', text: v, at: Date.now() });
    setText('');
    setPending(true);
    setTimeout(() => {
      append(id, { id: `m_${Date.now()}r`, role: 'assistant', text: demoReply(v, snap), at: Date.now(), demo: true });
      setPending(false);
    }, 700);
  };

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [text]);

  const fmt = (t: number) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(t);

  return (
    <div className="chat-layout">
      <aside className={`chat-list ${listOpen ? 'open' : ''}`} aria-label="对话列表">
        <div className="chat-list-head">
          <h2>对话</h2>
          <button className="icon-btn" aria-label="新建对话" onClick={() => { newChat(); setListOpen(false); }}><Plus size={18} /></button>
        </div>
        <ul>
          {conversations.map((c) => (
            <li key={c.id} className={c.id === active.id ? 'on' : ''}>
              <button className="chat-item" onClick={() => { setActive(c.id); setListOpen(false); }}>
                <span className="chat-item-title">{c.title}</span>
                <span className="muted">{c.messages.length ? fmt(c.updatedAt) : '空对话'}</span>
              </button>
              {c.messages.length > 0 && <button className="icon-btn" aria-label={`删除对话：${c.title}`} onClick={() => setDel(c)}><Trash2 size={15} /></button>}
            </li>
          ))}
        </ul>
      </aside>
      {listOpen && <button className="scrim" aria-label="关闭对话列表" onClick={() => setListOpen(false)} />}

      <section className="chat" aria-label="当前对话">
        <header className="chat-head">
          <button className="icon-btn chat-toggle" aria-label="对话列表" onClick={() => setListOpen(true)}><HistoryIcon size={18} /></button>
          <div className="chat-title">{active.title}</div>
          <span className="model-pill" title="Qwen3 将由后端接入">
            <i className="status-dot off" /> Qwen3 · 未连接
          </span>
        </header>

        {active.messages.length === 0 ? (
          <div className="chat-empty">
            <h2>想聊点什么？</h2>
            <p className="muted">当前回复由演示模板生成，尚未连接模型。财务数字来自当前账本的确定性计算。</p>
            <div className="chips">
              {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        ) : (
          <Bubbles c={active} pending={pending} />
        )}

        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            placeholder="输入消息"
            aria-label="消息"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
          />
          <button className="send" type="submit" disabled={!text.trim() || pending} aria-label="发送"><ArrowUp size={18} /></button>
        </form>
      </section>

      <ConfirmDialog open={!!del} title="删除这段对话？" message="删除后无法恢复。" confirmLabel="删除" danger onConfirm={() => { if (del) remove(del.id); setDel(null); }} onClose={() => setDel(null)} />
    </div>
  );
}
