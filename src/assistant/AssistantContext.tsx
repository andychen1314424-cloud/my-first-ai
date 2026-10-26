import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CHAT_MODELS, type AIModel, type AIStatus, type ChatEvent, type ChatMessage, type Conversation } from '../../shared/chat';

export type { Conversation } from '../../shared/chat';
export type Message = ChatMessage;
const MODEL_KEY = 'zx-ai-local-model';
const ACTIVE_KEY = 'zx-ai-chat-active';
const getPref = (key: string) => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } };
const savePref = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Private browser storage may be unavailable. */ } };
const initialStatus: AIStatus = {
  connected: false, message: '正在读取本地模型…', cloudEnabled: false,
  models: CHAT_MODELS.map((m) => ({ ...m, provider: 'ollama', installed: false, available: false, status: 'unavailable' })),
};
type Pending = { conversationId: string; modelId: string; phase: 'waiting' | 'streaming' | 'stopping' };
type Attempt = { conversationId: string; text: string; modelId: string; requestId: string };
interface Ctx {
  conversations: Conversation[];
  activeId: string;
  active: Conversation | null;
  setActive: (id: string) => void;
  newChat: () => Promise<string | undefined>;
  remove: (id: string) => Promise<boolean>;
  loading: boolean;
  creating: boolean;
  error: string;
  clearError: () => void;
  refreshConversations: () => Promise<void>;
  aiStatus: AIStatus;
  modelsLoading: boolean;
  modelError: string;
  refreshModels: () => Promise<void>;
  selectedModelId: string;
  selectedModel: AIModel | undefined;
  selectModel: (id: string) => void;
  drafts: Record<string, string>;
  setDraft: (id: string, text: string) => void;
  send: (text: string) => Promise<void>;
  stop: () => void;
  pending: Pending | null;
  uncertainAttempt: Attempt | null;
  checkLastAttempt: () => Promise<void>;
}
const C = createContext<Ctx | null>(null);
export function useAssistant() {
  const v = useContext(C);
  if (!v) throw new Error('useAssistant 必须在 AssistantProvider 内使用');
  return v;
}
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  if (!r.ok) {
    const data = await r.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error || `请求失败（${r.status}）`);
  }
  return (r.status === 204 ? undefined : await r.json()) as T;
}
const order = (items: Conversation[]) => [...items].sort((a, b) => b.updatedAt - a.updatedAt);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [conversations, setList] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState(() => getPref(ACTIVE_KEY));
  const activeRef = useRef(activeId);
  const listRef = useRef(conversations);
  const listRevision = useRef(0);
  activeRef.current = activeId;
  listRef.current = conversations;
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const createRef = useRef<Promise<string | undefined> | null>(null);
  const [error, setError] = useState('');
  const [aiStatus, setAIStatus] = useState<AIStatus>(initialStatus);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelError, setModelError] = useState('');
  const [selectedModelId, setSelected] = useState(() => getPref(MODEL_KEY) || 'deepseek-r1:1.5b');
  const hasSelection = useRef(Boolean(getPref(MODEL_KEY)));
  const modelRequest = useRef(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [uncertainAttempt, setUncertainAttempt] = useState<Attempt | null>(null);

  const setActive = useCallback((id: string) => { activeRef.current = id; setActiveId(id); savePref(ACTIVE_KEY, id); }, []);
  const refreshConversations = useCallback(async (options?: { ifIdle?: boolean; signal?: AbortSignal }) => {
    if (options?.ifIdle && (busy.current || createRef.current)) return;
    const revision = listRevision.current;
    const items = await api<Conversation[]>('/api/chat/conversations', { signal: options?.signal });
    if (revision !== listRevision.current || (options?.ifIdle && (busy.current || createRef.current))) return;
    setList(order(items));
    if (!items.some((c) => c.id === activeRef.current)) setActive(items[0]?.id ?? '');
  }, [setActive]);
  const visibleLast = conversations.find((c) => c.id === activeId)?.messages.at(-1);
  const externalMessageId = !pending && visibleLast?.role === 'assistant' && visibleLast.status === undefined ? visibleLast.id : '';
  useEffect(() => {
    if (!externalMessageId) return;
    const abort = new AbortController();
    let polling = false;
    const poll = async () => {
      if (polling || document.visibilityState !== 'visible' || busy.current || createRef.current) return;
      polling = true;
      try { await refreshConversations({ ifIdle: true, signal: abort.signal }); }
      catch { /* Preserve the unconfirmed message until the local service returns. */ }
      finally { polling = false; }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 1000);
    return () => { window.clearInterval(timer); abort.abort(); };
  }, [activeId, externalMessageId, refreshConversations]);
  const refreshModels = useCallback(async () => {
    const n = ++modelRequest.current;
    setModelsLoading(true);
    try {
      const data = await api<AIStatus>('/api/ai/status');
      if (n !== modelRequest.current) return;
      setAIStatus(data); setModelError('');
      if (!hasSelection.current) {
        const candidate = data.models.find((m) => m.id === 'deepseek-r1:1.5b' && m.available) ?? data.models.find((m) => m.available);
        if (candidate) { setSelected(candidate.id); hasSelection.current = true; savePref(MODEL_KEY, candidate.id); }
      }
    } catch (e) {
      if (n !== modelRequest.current) return;
      const message = e instanceof Error ? e.message : '无法读取模型状态';
      setModelError(message);
      setAIStatus((s) => ({ ...s, connected: false, message, models: s.models.map((m) => ({ ...m, available: false, status: 'unavailable' })) }));
    } finally { if (n === modelRequest.current) setModelsLoading(false); }
  }, []);
  useEffect(() => {
    let disposed = false;
    void refreshConversations().catch((e: unknown) => { if (!disposed) setError(e instanceof Error ? e.message : '对话读取失败'); }).finally(() => { if (!disposed) setLoading(false); });
    void refreshModels();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshModels(); }, 20000);
    const focus = () => { void refreshModels(); };
    window.addEventListener('focus', focus);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [refreshConversations, refreshModels]);
  useEffect(() => () => controller.current?.abort(), []);

  const newChat = useCallback((): Promise<string | undefined> => {
    if (createRef.current) return createRef.current;
    setCreating(true); setError('');
    const promise = api<Conversation>('/api/chat/conversations', { method: 'POST', body: '{}' })
      .then((c) => { listRevision.current++; setList((l) => order([c, ...l.filter((x) => x.id !== c.id)])); setActive(c.id); return c.id; })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : '新建对话失败'); return undefined; })
      .finally(() => { setCreating(false); createRef.current = null; });
    createRef.current = promise;
    return promise;
  }, [setActive]);
  const remove = useCallback(async (id: string) => {
    if (controller.current && pending?.conversationId === id) { setError('请先停止这段对话的回复，再删除。'); return false; }
    try {
      await api<void>(`/api/chat/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      listRevision.current++;
      const next = listRef.current.filter((c) => c.id !== id);
      setList(next);
      if (activeRef.current === id) setActive(next[0]?.id ?? '');
      setDrafts((d) => { const copy = { ...d }; delete copy[id]; return copy; });
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : '删除失败'); return false; }
  }, [pending?.conversationId, setActive]);
  const selectModel = useCallback((id: string) => { hasSelection.current = true; setSelected(id); savePref(MODEL_KEY, id); }, []);
  const setDraft = useCallback((id: string, text: string) => setDrafts((d) => ({ ...d, [id]: text })), []);

  const runAttempt = useCallback(async (attempt: Attempt, draftKey: string) => {
    listRevision.current++;
    const abort = new AbortController();
    controller.current = abort;
    setPending({ conversationId: attempt.conversationId, modelId: attempt.modelId, phase: 'waiting' });
    setError(''); setUncertainAttempt(null);
    let assistantId = '';
    let finished = false;
    let started = false;
    const updateAssistant = (fn: (m: ChatMessage) => ChatMessage) => setList((l) => l.map((c) => c.id === attempt.conversationId ? { ...c, messages: c.messages.map((m) => m.id === assistantId ? fn(m) : m) } : c));
    try {
      const r = await fetch(`/api/chat/conversations/${encodeURIComponent(attempt.conversationId)}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: attempt.text, modelId: attempt.modelId, requestId: attempt.requestId }), signal: abort.signal,
      });
      if (!r.ok) {
        const data = await r.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || `发送失败（${r.status}）`);
      }
      if (!r.body) throw new Error('服务没有返回消息流。');
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let received = 0;
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const ev = JSON.parse(line) as ChatEvent;
        if (ev.type === 'start') {
          if (!ev.user?.id || !ev.assistant?.id) throw new Error('消息流格式不正确。');
          started = true; assistantId = ev.assistant.id;
          setList((l) => order(l.map((c) => c.id === attempt.conversationId ? {
            ...c, title: c.messages.length ? c.title : attempt.text.slice(0, 18), updatedAt: ev.user.at,
            messages: [...c.messages.filter((m) => m.id !== ev.user.id && m.id !== ev.assistant.id), ev.user, ev.assistant],
          } : c)));
          setDrafts((d) => d[draftKey]?.trim() === attempt.text ? { ...d, [draftKey]: '' } : d);
        } else if (ev.type === 'delta' && typeof ev.text === 'string') {
          updateAssistant((m) => ({ ...m, text: m.text + ev.text }));
          setPending((p) => p ? { ...p, phase: 'streaming' } : p);
        } else if (ev.type === 'done') {
          finished = true; assistantId = ev.message.id;
          updateAssistant(() => ev.message);
        } else if (ev.type === 'error') {
          finished = true;
          if (ev.message) { assistantId = ev.message.id; updateAssistant(() => ev.message!); }
          setError(ev.error || '模型回复失败。');
        }
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > 3 * 1024 * 1024) throw new Error('消息流过长，已停止接收。');
          buffer += decoder.decode(value, { stream: true });
          let index: number;
          while ((index = buffer.indexOf('\n')) >= 0) { handleLine(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
        }
        buffer += decoder.decode();
        if (buffer.trim()) handleLine(buffer);
        if (!finished) throw new Error('连接中断，回复可能尚未完成。');
      } finally { await reader.cancel().catch(() => {}); }
    } catch (e) {
      if (abort.signal.aborted) {
        updateAssistant((m) => ({ ...m, status: 'stopped' }));
        if (!started) setError('已停止请求。');
      } else {
        const message = e instanceof Error ? e.message : '发送失败，请稍后重试。';
        setError(message);
        if (!finished) { setUncertainAttempt(attempt); updateAssistant((m) => ({ ...m, status: 'error', error: message })); }
      }
    } finally {
      if (!finished) abort.abort();
      if (abort.signal.aborted) await new Promise((resolve) => window.setTimeout(resolve, 180));
      try { await refreshConversations(); } catch { /* Preserve visible partial messages while offline. */ }
      setPending(null); controller.current = null; busy.current = false;
    }
  }, [refreshConversations]);
  const send = useCallback(async (text: string) => {
    const value = text.trim();
    if (!value || busy.current) return;
    if (value.length > 6000) { setError('消息最多 6000 个字符。'); return; }
    const model = aiStatus.models.find((m) => m.id === selectedModelId);
    if (!model?.available) { setError('所选本地模型暂不可用，请检查模型中心。'); return; }
    busy.current = true;
    let draftKey = activeRef.current;
    const id = activeRef.current || await newChat();
    if (!id) { busy.current = false; return; }
    if (!draftKey) {
      setDrafts((d) => ({ ...d, [id]: d[''] ?? value, '': '' }));
      draftKey = id;
    }
    await runAttempt({ conversationId: id, text: value, modelId: selectedModelId, requestId: crypto.randomUUID() }, draftKey);
  }, [aiStatus.models, selectedModelId, newChat, runAttempt]);
  const checkLastAttempt = useCallback(async () => {
    if (!uncertainAttempt || busy.current) return;
    busy.current = true;
    await runAttempt(uncertainAttempt, uncertainAttempt.conversationId);
  }, [uncertainAttempt, runAttempt]);
  const stop = useCallback(() => { setPending((p) => p ? { ...p, phase: 'stopping' } : p); controller.current?.abort(); }, []);
  const clearError = useCallback(() => { setError(''); }, []);
  const value = useMemo<Ctx>(() => ({
    conversations, activeId, active: conversations.find((c) => c.id === activeId) ?? null, setActive, newChat, remove,
    loading, creating, error, clearError, refreshConversations, aiStatus, modelsLoading, modelError, refreshModels,
    selectedModelId, selectedModel: aiStatus.models.find((m) => m.id === selectedModelId), selectModel,
    drafts, setDraft, send, stop, pending, uncertainAttempt, checkLastAttempt,
  }), [conversations, activeId, setActive, newChat, remove, loading, creating, error, clearError, refreshConversations, aiStatus, modelsLoading, modelError, refreshModels, selectedModelId, selectModel, drafts, setDraft, send, stop, pending, uncertainAttempt, checkLastAttempt]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
