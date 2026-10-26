import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../shared/domain.ts';
import { isChatModel } from '../shared/chat.ts';
import type { ChatMessage, Conversation } from '../shared/chat.ts';

export interface ChatInput { text: string; modelId: string; requestId: string }
export interface Exchange { user: ChatMessage; assistant: ChatMessage }

export function validateChatInput(value: unknown): ChatInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('消息格式不正确。');
  const p = value as Record<string, unknown>;
  if (Object.keys(p).sort().join(',') !== 'modelId,requestId,text') throw new AppError('消息字段不正确。');
  if (typeof p.text !== 'string' || !p.text.trim() || p.text.trim().length > 6000)
    throw new AppError('消息需为 1–6000 个字符。');
  if (!isChatModel(p.modelId)) throw new AppError('请选择支持的本地模型。');
  if (typeof p.requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(p.requestId))
    throw new AppError('缺少合法的消息请求标识。');
  return { text: p.text.trim(), modelId: p.modelId, requestId: p.requestId };
}

function titleInput(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('对话格式不正确。');
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some((k) => k !== 'title') || (p.title !== undefined && (typeof p.title !== 'string' || !p.title.trim() || p.title.trim().length > 100)))
    throw new AppError('对话标题需为 1–100 个字符。');
  return typeof p.title === 'string' ? p.title.trim() : '新对话';
}

export function openChatStore(filename: string) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;');
  function checkVersion() {
    const versions = db.prepare('SELECT version FROM chat_meta').all();
    if (versions.length !== 1 || versions[0].version !== 1)
      throw new AppError('聊天数据库版本不受当前程序支持。', 500);
  }
  try {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_meta'").get()) checkVersion();
    transaction(() => db.exec(`
    CREATE TABLE IF NOT EXISTS chat_meta (version INTEGER NOT NULL) STRICT;
    INSERT INTO chat_meta SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM chat_meta);
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')), text TEXT NOT NULL, at INTEGER NOT NULL,
      model_id TEXT, status TEXT CHECK(status IN ('complete','stopped','error')), error TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS chat_messages_conversation ON chat_messages(conversation_id,at);
    CREATE TABLE IF NOT EXISTS chat_requests (
      request_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, input_hash TEXT NOT NULL,
      user_id TEXT NOT NULL, assistant_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','complete','stopped','error','deleted'))
    ) STRICT;`));
    checkVersion();
  } catch (error) {
    db.close();
    throw error;
  }
  function transaction<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  // A process restart must never leave a message indefinitely generating.
  transaction(() => {
    db.prepare("UPDATE chat_messages SET status='stopped',error='服务曾中断，可重新发送消息。' WHERE id IN (SELECT assistant_id FROM chat_requests WHERE state='pending')").run();
    db.prepare("UPDATE chat_requests SET state='stopped' WHERE state='pending'").run();
  });
  function message(row: Record<string, unknown>): ChatMessage {
    return {
      id: String(row.id), role: row.role as ChatMessage['role'], text: String(row.text), at: Number(row.at),
      ...(row.model_id ? { modelId: String(row.model_id) } : {}),
      ...(row.status ? { status: row.status as ChatMessage['status'] } : {}),
      ...(row.error ? { error: String(row.error) } : {}),
    };
  }
  function get(id: string): Conversation {
    const row = db.prepare('SELECT * FROM chat_conversations WHERE id=?').get(id);
    if (!row) throw new AppError('找不到这段对话。', 404);
    return { id, title: String(row.title), updatedAt: Number(row.updated_at), messages: db.prepare('SELECT * FROM chat_messages WHERE conversation_id=? ORDER BY rowid').all(id).map(message) };
  }
  function hash(id: string, input: ChatInput) {
    return createHash('sha256').update(JSON.stringify({ conversationId: id, text: input.text, modelId: input.modelId })).digest('hex');
  }
  function lookup(id: string, input: ChatInput): Exchange | undefined {
    const row = db.prepare('SELECT * FROM chat_requests WHERE request_id=?').get(input.requestId);
    if (!row) { get(id); return undefined; }
    if (row.state === 'deleted') throw new AppError('该请求对应的对话已删除，请使用新请求标识。', 410);
    if (row.input_hash !== hash(id, input)) throw new AppError('同一个消息请求标识不能用于不同内容。', 409);
    if (row.state === 'pending') throw new AppError('这条消息仍在生成，请稍后刷新。', 409);
    const user = db.prepare('SELECT * FROM chat_messages WHERE id=?').get(row.user_id as string);
    const assistant = db.prepare('SELECT * FROM chat_messages WHERE id=?').get(row.assistant_id as string);
    if (!user || !assistant) throw new AppError('该请求的消息已不可用。', 410);
    return { user: message(user), assistant: message(assistant) };
  }
  return {
    close: () => db.close(),
    get,
    lookup,
    list(): Conversation[] {
      return db.prepare('SELECT id FROM chat_conversations ORDER BY updated_at DESC,rowid DESC').all().map((r) => get(String(r.id)));
    },
    create(value: unknown = {}): Conversation {
      const title = titleInput(value);
      if (Number(db.prepare('SELECT count(*) AS n FROM chat_conversations').get()!.n) >= 200)
        throw new AppError('最多保存 200 段对话，请先删除不需要的对话。', 409);
      const id = randomUUID();
      db.prepare('INSERT INTO chat_conversations VALUES(?,?,?)').run(id, title, Date.now());
      return get(id);
    },
    rename(id: string, value: unknown): Conversation {
      const title = titleInput(value);
      get(id);
      db.prepare('UPDATE chat_conversations SET title=?,updated_at=? WHERE id=?').run(title, Date.now(), id);
      return get(id);
    },
    remove(id: string) {
      transaction(() => {
        get(id);
        if (db.prepare("SELECT 1 FROM chat_requests WHERE conversation_id=? AND state='pending'").get(id))
          throw new AppError('请先停止正在生成的消息，再删除对话。', 409);
        // Retain only the request-ID tombstone, never the deleted text or its hash.
        db.prepare("UPDATE chat_requests SET state='deleted',input_hash='',conversation_id='',user_id='',assistant_id='' WHERE conversation_id=?").run(id);
        db.prepare('DELETE FROM chat_conversations WHERE id=?').run(id);
      });
    },
    begin(id: string, input: ChatInput): Exchange {
      return transaction(() => {
        const existing = lookup(id, input);
        if (existing) throw new AppError('该消息已经处理，请刷新后查看。', 409);
        const c = get(id);
        if (c.messages.length >= 1000) throw new AppError('这段对话已达 500 轮，请新建对话。', 409);
        const at = Date.now();
        const user: ChatMessage = { id: randomUUID(), role: 'user', text: input.text, at, status: 'complete' };
        const assistant: ChatMessage = { id: randomUUID(), role: 'assistant', text: '', at: at + 1, modelId: input.modelId };
        db.prepare('INSERT INTO chat_messages VALUES(?,?,?,?,?,?,?,?)').run(user.id, id, user.role, user.text, user.at, null, 'complete', null);
        db.prepare('INSERT INTO chat_messages VALUES(?,?,?,?,?,?,?,?)').run(assistant.id, id, assistant.role, '', assistant.at, input.modelId, null, null);
        db.prepare('INSERT INTO chat_requests VALUES(?,?,?,?,?,?)').run(input.requestId, id, hash(id, input), user.id, assistant.id, 'pending');
        db.prepare('UPDATE chat_conversations SET title=?,updated_at=? WHERE id=?').run(c.messages.length || c.title !== '新对话' ? c.title : input.text.slice(0, 30), at + 1, id);
        return { user, assistant };
      });
    },
    context(id: string, currentUser: ChatMessage): { role: 'user' | 'assistant'; content: string }[] {
      const completed = db.prepare("SELECT m.* FROM chat_messages m JOIN chat_requests r ON (m.id=r.user_id OR m.id=r.assistant_id) WHERE m.conversation_id=? AND r.state='complete' ORDER BY m.rowid").all(id).map(message);
      const turns: { role: 'user' | 'assistant'; content: string }[][] = [];
      for (let n = 0; n + 1 < completed.length; n += 2) {
        if (completed[n].role === 'user' && completed[n + 1].role === 'assistant')
          turns.push([{ role: 'user', content: completed[n].text }, { role: 'assistant', content: completed[n + 1].text }]);
      }
      const selected: { role: 'user' | 'assistant'; content: string }[][] = [];
      let length = currentUser.text.length;
      for (const turn of turns.slice(-10).reverse()) {
        const chars = turn.reduce((n, m) => n + m.content.length, 0);
        if (length + chars > 12000) break;
        length += chars; selected.unshift(turn);
      }
      return [...selected.flat(), { role: 'user', content: currentUser.text }];
    },
    checkpoint(requestId: string, text: string) {
      if (text.length > 65536) throw new AppError('模型回复超出保存上限。', 502);
      db.prepare("UPDATE chat_messages SET text=? WHERE id=(SELECT assistant_id FROM chat_requests WHERE request_id=? AND state='pending')").run(text, requestId);
    },
    finish(requestId: string, text: string, status: 'complete' | 'stopped' | 'error', error?: string): ChatMessage {
      if (text.length > 65536) throw new AppError('模型回复超出保存上限。', 502);
      if (status === 'complete' && !text.trim()) throw new AppError('模型没有返回可显示的最终答案。', 502);
      return transaction(() => {
        const row = db.prepare('SELECT * FROM chat_requests WHERE request_id=?').get(requestId);
        if (!row || row.state !== 'pending') throw new AppError('这条消息已经结束。', 409);
        db.prepare('UPDATE chat_messages SET text=?,status=?,error=? WHERE id=?').run(text, status, error ?? null, row.assistant_id as string);
        db.prepare('UPDATE chat_requests SET state=? WHERE request_id=?').run(status, requestId);
        db.prepare('UPDATE chat_conversations SET updated_at=? WHERE id=?').run(Date.now(), row.conversation_id as string);
        return message(db.prepare('SELECT * FROM chat_messages WHERE id=?').get(row.assistant_id as string)!);
      });
    },
  };
}
export type ChatStore = ReturnType<typeof openChatStore>;
