import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  demo?: boolean;
}
export interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
}

interface Ctx {
  conversations: Conversation[];
  activeId: string;
  active: Conversation;
  setActive: (id: string) => void;
  newChat: () => string;
  append: (id: string, m: Message) => void;
  rename: (id: string, title: string) => void;
  remove: (id: string) => void;
}
const C = createContext<Ctx | null>(null);
export const useAssistant = () => {
  const v = useContext(C);
  if (!v) throw new Error('useAssistant 必须在 AssistantProvider 内使用');
  return v;
};

const uid = () => `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const blank = (): Conversation => ({ id: uid(), title: '新对话', updatedAt: Date.now(), messages: [] });

// 对话保存在内存中（演示）。正式版：由后端持久化，接口见 docs/UI-HANDOFF.md。
export function AssistantProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Conversation[]>(() => [blank()]);
  const [activeId, setActiveId] = useState(() => list[0].id);

  const newChat = useCallback(() => {
    const c = blank();
    setList((l) => (l[0]?.messages.length === 0 ? [c, ...l.slice(1)] : [c, ...l]));
    setActiveId(c.id);
    return c.id;
  }, []);
  const append = useCallback((id: string, m: Message) => {
    setList((l) =>
      l
        .map((c) =>
          c.id === id
            ? { ...c, messages: [...c.messages, m], updatedAt: m.at, title: c.messages.length === 0 && m.role === 'user' ? m.text.slice(0, 18) : c.title }
            : c,
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    );
  }, []);
  const rename = useCallback((id: string, title: string) => setList((l) => l.map((c) => (c.id === id ? { ...c, title } : c))), []);
  const remove = useCallback(
    (id: string) => {
      setList((l) => {
        const rest = l.filter((c) => c.id !== id);
        if (rest.length === 0) {
          const c = blank();
          setActiveId(c.id);
          return [c];
        }
        if (id === activeId) setActiveId(rest[0].id);
        return rest;
      });
    },
    [activeId],
  );

  const value = useMemo<Ctx>(
    () => ({
      conversations: list,
      activeId,
      active: list.find((c) => c.id === activeId) ?? list[0],
      setActive: setActiveId,
      newChat,
      append,
      rename,
      remove,
    }),
    [list, activeId, newChat, append, rename, remove],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}
