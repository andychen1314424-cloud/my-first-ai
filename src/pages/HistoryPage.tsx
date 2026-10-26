import { useMemo, useState } from 'react';
import { MessageSquare, Search } from 'lucide-react';
import { Link, navigate } from '../router';
import { Empty, PageHead, Segmented } from '../ui/primitives';
import { useAssistant } from '../assistant/AssistantContext';
import { useFinance } from '../finance/FinanceContext';
import { yuan } from '../finance/money';
import { txIcon } from '../finance/meta';

type Tab = 'all' | 'chat' | 'finance' | 'lab';

export function HistoryPage() {
  const { conversations, setActive } = useAssistant();
  const { snap, openQuickAdd } = useFinance();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const chats = conversations.filter((c) => c.messages.length).map((c) => ({ kind: 'chat' as const, at: c.updatedAt, key: c.id, title: c.title, sub: `AI 对话，${c.messages.length} 条消息`, c }));
    const txs = (snap?.transactions ?? []).slice(0, 60).map((t) => ({
      kind: 'finance' as const,
      at: new Date(t.date + 'T12:00:00').getTime(),
      key: t.id,
      title: t.note || snap?.categories.find((x) => x.id === t.categoryId)?.name || '记录',
      sub: `${t.date}，${snap?.isDemo ? '财务演示数据' : '本地账本'}`,
      t,
    }));
    return [...chats, ...txs]
      .filter((i) => (tab === 'all' ? true : i.kind === tab))
      .filter((i) => !needle || i.title.toLowerCase().includes(needle))
      .sort((a, b) => b.at - a.at);
  }, [conversations, snap, tab, q]);

  return (
    <div className="page">
      <PageHead title="历史记录" sub="对话与财务记录" />
      <div className="filters">
        <Segmented label="筛选" value={tab} onChange={setTab} options={[{ value: 'all', label: '全部' }, { value: 'chat', label: '对话' }, { value: 'finance', label: '财务' }, { value: 'lab', label: '项目' }]} />
        <label className="search"><Search size={16} aria-hidden /><input placeholder="搜索标题" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜索历史" /></label>
      </div>
      {tab === 'lab' ? (
        <Empty title="项目历史保存在项目实验台" hint="项目、任务进度与复盘沿用原有后端保存。" action={<Link to="/lab" className="btn">打开项目历史</Link>} />
      ) : items.length === 0 ? (
        <Empty title="没有找到记录" hint={q ? '换个关键词试试。' : '开始一次对话或记一笔，这里就会出现记录。'} />
      ) : (
        <ul className="list card">
          {items.slice(0, 80).map((i) => {
            if (i.kind === 'chat') {
              return (
                <li key={i.key}>
                  <button className="row row-btn" onClick={() => { setActive(i.c.id); navigate('/assistant'); }}>
                    <span className="ico"><MessageSquare size={18} /></span>
                    <span className="row-main"><span>{i.title}</span><span className="muted">{i.sub}</span></span>
                  </button>
                </li>
              );
            }
            const I = txIcon(i.t);
            return (
              <li key={i.key}>
                <button className="row row-btn" onClick={() => openQuickAdd(i.t)}>
                  <span className="ico"><I size={18} /></span>
                  <span className="row-main"><span>{i.title}</span><span className="muted">{i.sub}</span></span>
                  <span className="num">{i.t.type === 'income' ? '+' : i.t.type === 'expense' ? '-' : ''}{yuan(i.t.amount)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
