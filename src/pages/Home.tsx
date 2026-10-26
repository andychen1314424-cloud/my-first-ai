import { ArrowRight, FlaskConical, MessageSquare, Target, Plus, Wallet } from 'lucide-react';
import { Link, navigate } from '../router';
import { DemoTag, DevTag } from '../ui/primitives';
import { useFinance } from '../finance/FinanceContext';
import { useAssistant } from '../assistant/AssistantContext';
import { overview } from '../finance/calc';
import { yuan } from '../finance/money';
import { txIcon } from '../finance/meta';

const fmtDate = () => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());

export function HomePage() {
  const { snap, openQuickAdd } = useFinance();
  const { newChat, conversations, setActive } = useAssistant();
  const o = snap ? overview(snap) : null;
  const catName = (id?: string) => snap?.categories.find((c) => c.id === id)?.name ?? '';

  const chats = conversations.filter((c) => c.messages.length > 0).slice(0, 2);
  const txs = (snap?.transactions ?? []).slice(0, 4);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="muted">{fmtDate()}</p>
          <h1>工作台</h1>
        </div>
      </header>

      <section className="quick" aria-label="快捷操作">
        <button className="btn btn-primary" onClick={() => openQuickAdd()}><Plus size={16} /> 记一笔</button>
        <button className="btn" onClick={() => { newChat(); navigate('/assistant'); }}><MessageSquare size={16} /> 新对话</button>
        <Link to="/finance/budget" className="btn"><Target size={16} /> 查看预算</Link>
        <Link to="/lab" className="btn"><FlaskConical size={16} /> 新建项目</Link>
      </section>

      <section className="modules" aria-label="应用">
        <Link to="/finance" className="card module">
          <div className="module-head"><Wallet size={20} /><h2>ZX Finance</h2>{snap?.isDemo && <DemoTag />}</div>
          {o ? (
            <>
              <p className="module-num num">{yuan(o.net)}</p>
              <p className="muted">净资产　本月支出 {yuan(o.expense)}</p>
            </>
          ) : <p className="muted">正在读取…</p>}
          <span className="module-go">打开 <ArrowRight size={14} /></span>
        </Link>
        <Link to="/assistant" className="card module">
          <div className="module-head"><MessageSquare size={20} /><h2>AI 助手</h2><DevTag label="演示" /></div>
          <p className="module-text">提问、整理想法，也能查询你的账本。</p>
          <p className="muted">Qwen3 尚未连接</p>
          <span className="module-go">打开 <ArrowRight size={14} /></span>
        </Link>
        <Link to="/lab" className="card module">
          <div className="module-head"><FlaskConical size={20} /><h2>项目实验台</h2></div>
          <p className="module-text">把一个想法拆成任务，跟踪进度并复盘。</p>
          <p className="muted">原有功能保留</p>
          <span className="module-go">打开 <ArrowRight size={14} /></span>
        </Link>
      </section>

      <section>
        <div className="row-between"><h2 className="h2">最近活动</h2><Link to="/history" className="link">全部</Link></div>
        {chats.length + txs.length === 0 ? (
          <p className="muted">暂无活动。</p>
        ) : (
          <ul className="list card">
            {chats.map((c) => (
              <li key={c.id}>
                <button className="row row-btn" onClick={() => { setActive(c.id); navigate('/assistant'); }}>
                  <span className="ico"><MessageSquare size={18} /></span>
                  <span className="row-main"><span>{c.title}</span><span className="muted">AI 对话，{c.messages.length} 条消息</span></span>
                </button>
              </li>
            ))}
            {txs.map((t) => {
              const I = txIcon(t);
              return (
                <li key={t.id}>
                  <button className="row row-btn" onClick={() => openQuickAdd(t)}>
                    <span className="ico"><I size={18} /></span>
                    <span className="row-main"><span>{t.note || catName(t.categoryId)}</span><span className="muted">{t.date.slice(5)}，{snap?.isDemo ? '财务演示数据' : '本地账本'}</span></span>
                    <span className="num">{t.type === 'income' ? '+' : t.type === 'expense' ? '-' : ''}{yuan(t.amount)}</span>
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
