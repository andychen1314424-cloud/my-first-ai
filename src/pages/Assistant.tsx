import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Copy, History as HistoryIcon, Plus, RefreshCw, Square, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../ui/primitives';
import { useAssistant, type Conversation, type Message } from '../assistant/AssistantContext';
import { ModelPicker } from '../assistant/ModelCenter';
import { Link } from '../router';
import { useToast } from '../ui/toast';

const SUGGESTIONS = ['帮我把今天的想法整理成行动清单', '解释一个我想学习的概念', '帮我润色一段文字', '一起拆解一个项目的下一步'];
const fmt = (t: number) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(t);

// Render model output as React text nodes. HTML and links from the model never execute.
function MessageBody({ text }: { text: string }) {
  const toast = useToast();
  const pieces = text.split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g);
  return <>{pieces.map((piece, i) => {
    if (piece.startsWith('```')) {
      const firstLine = piece.indexOf('\n');
      const language = piece.slice(3, firstLine).trim();
      const code = piece.slice(firstLine + 1).replace(/```$/, '');
      return <div className="message-code" key={i}><div className="code-head"><span>{language || '代码'}</span><button type="button" className="text-btn" aria-label="复制代码" onClick={() => { void navigator.clipboard.writeText(code).then(() => toast('代码已复制')).catch(() => toast('请选中代码手动复制')); }}><Copy size={13} />复制</button></div><pre><code>{code}</code></pre></div>;
    }
    return <span key={i}>{piece}</span>;
  })}</>;
}

function Bubbles({ c, onRetry }: { c: Conversation; onRetry: (m: Message, index: number) => void }) {
  const { pending, aiStatus } = useAssistant();
  const toast = useToast();
  const end = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nearEnd = useRef(true);
  const last = c.messages[c.messages.length - 1];
  const runningHere = pending?.conversationId === c.id;
  useEffect(() => { nearEnd.current = true; end.current?.scrollIntoView({ block: 'end' }); }, [c.id]);
  useEffect(() => { if (nearEnd.current) end.current?.scrollIntoView({ block: 'end' }); }, [c.messages.length, last?.text, pending?.phase]);
  return (
    <div className="messages" ref={scroller} role="log" aria-live="polite" aria-label="聊天消息" onScroll={() => { const el = scroller.current; if (el) nearEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }}>
      {c.messages.map((m, index) => {
        const generating = runningHere && m.id === last?.id && m.role === 'assistant';
        const model = aiStatus.models.find((x) => x.id === m.modelId);
        return <div key={m.id} className={`msg ${m.role}`}>
          {m.role === 'assistant' && <span className="message-meta">{model?.name || m.modelId || '本地模型'}</span>}
          <div className={`bubble ${generating && !m.text ? 'typing' : ''}`}>
            {generating && !m.text ? <><i /><i /><i /><span className="sr-only">正在等待模型回复</span></> : <MessageBody text={m.text || (m.status === 'error' ? '本次没有生成可保存的回答。' : '已停止，尚未生成正文。')} />}
          </div>
          {m.role === 'assistant' && <div className="message-actions">
            {m.text && <button type="button" className="text-btn" aria-label="复制回复" onClick={() => { void navigator.clipboard.writeText(m.text).then(() => toast('回复已复制')).catch(() => toast('请选中文字手动复制')); }}><Copy size={13} />复制</button>}
            {!generating && m.status === undefined && <span>尚未确认完成 · 正在同步</span>}
            {!generating && m.status === 'stopped' && <span>已停止 · 回答未完成</span>}
            {!generating && m.status === 'error' && <span className="field-error">{m.error || '回复未完成'}</span>}
            {!generating && (m.status === 'stopped' || m.status === 'error') && <button type="button" className="text-btn" onClick={() => onRetry(m, index)}><RefreshCw size={13} />重新提问</button>}
          </div>}
        </div>;
      })}
      {runningHere && (!last || last.role !== 'assistant') && <div className="msg assistant"><div className="bubble typing" aria-label="正在等待模型回复"><i /><i /><i /></div></div>}
      <div ref={end} />
    </div>
  );
}

export function AssistantPage() {
  const { conversations, activeId, active, setActive, newChat, remove, loading, creating, error, clearError,
    aiStatus, selectedModel, drafts, setDraft, send, stop, pending, uncertainAttempt, checkLastAttempt, refreshConversations } = useAssistant();
  const [listOpen, setListOpen] = useState(false);
  const [del, setDel] = useState<Conversation | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  const text = drafts[activeId] ?? '';
  const runningHere = pending?.conversationId === activeId;
  const canSend = !!selectedModel?.available && !pending && !creating && !loading;
  const valueTooLong = text.length > 6000;

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight + 2, 160) + 'px';
  }, [text, activeId]);
  const retry = (_m: Message, index: number) => {
    const question = active?.messages.slice(0, index).reverse().find((m) => m.role === 'user');
    if (!question) return;
    setDraft(activeId, question.text); clearError(); taRef.current?.focus();
    toast('已填入上个问题，确认模型后发送，将保存为新的提问。');
  };
  const submit = () => { if (canSend && text.trim() && !valueTooLong) void send(text); };

  return (
    <div className="chat-layout">
      <aside className={`chat-list ${listOpen ? 'open' : ''}`} aria-label="对话列表">
        <div className="chat-list-head"><h2>对话</h2><button className="icon-btn" aria-label="新建对话" disabled={creating || loading} onClick={() => { void newChat(); setListOpen(false); }}><Plus size={18} /></button></div>
        <p className="hint chat-storage-note">保存在本机 SQLite</p>
        {loading ? <p className="muted">正在读取对话…</p> : conversations.length === 0 ? <p className="muted chat-list-empty">还没有对话。发送消息即可开始。</p> : <ul>
          {conversations.map((c) => <li key={c.id} className={c.id === activeId ? 'on' : ''}>
            <button className="chat-item" onClick={() => { setActive(c.id); setListOpen(false); }}><span className="chat-item-title">{c.title}</span><span className="muted">{pending?.conversationId === c.id ? '正在回复…' : c.messages.length ? fmt(c.updatedAt) : '空对话'}</span></button>
            <button className="icon-btn" aria-label={`删除对话：${c.title}`} disabled={pending?.conversationId === c.id} onClick={() => setDel(c)}><Trash2 size={15} /></button>
          </li>)}
        </ul>}
      </aside>
      {listOpen && <button className="scrim" aria-label="关闭对话列表" onClick={() => setListOpen(false)} />}

      <section className="chat" aria-label="当前对话">
        <header className="chat-head">
          <button className="icon-btn chat-toggle" aria-label="对话列表" onClick={() => setListOpen(true)}><HistoryIcon size={18} /></button>
          <div className="chat-title">{active?.title || '新对话'}</div>
          <span className="local-chat-badge"><i className={`status-dot ${selectedModel?.available ? '' : 'off'}`} />本地</span>
          <ModelPicker compact />
        </header>
        <div className="chat-notice"><span>本地推理 · 云端关闭 · 财务数据尚未接入聊天</span><Link to="/settings" className="link">模型中心</Link></div>
        {!aiStatus.connected && <div className="chat-alert" role="status">{aiStatus.message} <Link to="/settings" className="link">检查连接</Link></div>}
        {error && <div className="chat-alert error" role="alert"><span>{error}</span><div className="inline"><button className="text-btn" onClick={() => { void refreshConversations().then(clearError).catch(() => toast('服务暂时不可用，请检查启动终端。')); }}>重新读取</button><button className="text-btn" onClick={clearError} aria-label="关闭消息提示">关闭</button></div></div>}
        {uncertainAttempt && !pending && <div className="chat-alert"><span>上次请求的保存结果尚未确认。</span><button className="text-btn" onClick={() => void checkLastAttempt()}>检查上次请求</button></div>}
        {active?.messages.length ? <Bubbles c={active} onRetry={retry} /> : <div className="chat-empty">
          <h2>{loading ? '正在读取对话…' : '想聊点什么？'}</h2>
          <p className="muted">{selectedModel?.available ? `由 ${selectedModel.name} 在本机回答。` : '先在模型中心检查并选择已安装的本地模型。'}</p>
          <div className="chips">{SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => { setDraft(activeId, s); taRef.current?.focus(); }}>{s}</button>)}</div>
        </div>}
        {pending && <div className="chat-generation" role="status"><span>{runningHere ? pending.phase === 'stopping' ? '正在停止并保存已生成内容…' : pending.phase === 'waiting' ? '正在加载模型并等待首字…' : '正在生成回复…' : '另一段对话正在生成，可切换查看。'}</span>{!runningHere && <button className="text-btn" onClick={() => setActive(pending.conversationId)}>查看</button>}<button className="text-btn" disabled={pending.phase === 'stopping'} onClick={stop}><Square size={12} />停止生成</button></div>}
        <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <textarea ref={taRef} rows={1} value={text} placeholder={selectedModel?.available ? '输入消息，Enter 发送' : '先在模型中心选择可用模型'} aria-label="消息" onChange={(e) => setDraft(activeId, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
          <button className="send" type="submit" disabled={!text.trim() || !canSend || valueTooLong} aria-label="发送"><ArrowUp size={18} /></button>
        </form>
        {valueTooLong && <p className="composer-hint field-error">消息最多 6000 个字符，请缩短后发送。</p>}
      </section>
      <ConfirmDialog open={!!del} title="删除这段对话？" message="将删除本机保存的这段对话，删除后无法恢复。" confirmLabel="删除" danger onConfirm={async () => { if (del && await remove(del.id)) setDel(null); }} onClose={() => setDel(null)} />
    </div>
  );
}
