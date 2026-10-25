import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, PROMPT_VERSION, buildMessages } from '../shared/domain.ts';
import type { Brief, Plan, Project, Summary } from '../shared/domain.ts';

export function openStore(filename: string) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL
    ); PRAGMA user_version = 1;`);
  function get(id: string): Project {
    const row = db.prepare('SELECT payload FROM projects WHERE id = ?').get(id);
    if (!row) throw new AppError('找不到这个项目。', 404);
    return JSON.parse(String(row.payload)) as Project;
  }
  function save(project: Project, expectedRevision: number) {
    const updated = {
      ...project,
      revision: expectedRevision + 1,
      updatedAt: new Date().toISOString(),
    };
    const r = db
      .prepare(
        'UPDATE projects SET payload = ?, updated_at = ?, revision = ? WHERE id = ? AND revision = ?',
      )
      .run(
        JSON.stringify(updated),
        updated.updatedAt,
        updated.revision,
        project.id,
        expectedRevision,
      );
    if (r.changes !== 1) throw new AppError('项目已在其他窗口更新，请先重新打开项目再保存。', 409);
    return updated;
  }
  return {
    close: () => db.close(),
    get,
    list(): Summary[] {
      return db
        .prepare('SELECT payload FROM projects ORDER BY updated_at DESC, rowid DESC')
        .all()
        .map((row) => {
          const p = JSON.parse(String(row.payload)) as Project;
          return {
            id: p.id,
            title: p.plan.title,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
            source: p.source,
            total: p.plan.tasks.length,
            completed: p.done.filter(Boolean).length,
          };
        });
    },
    create(brief: Brief, plan: Plan, source: Project['source'], durationMs = 0): Project {
      const now = new Date().toISOString();
      const p: Project = {
        id: randomUUID(),
        brief,
        plan,
        source,
        durationMs,
        done: plan.tasks.map(() => false),
        notes: '',
        revision: 1,
        createdAt: now,
        updatedAt: now,
        prompt: { version: PROMPT_VERSION, messages: buildMessages(brief) },
      };
      db.prepare(
        'INSERT INTO projects (id, payload, updated_at, revision) VALUES (?, ?, ?, ?)',
      ).run(p.id, JSON.stringify(p), now, 1);
      return p;
    },
    update(id: string, value: unknown): Project {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new AppError('修改数据格式不正确。');
      const patch = value as Record<string, unknown>;
      if (!Number.isInteger(patch.revision)) throw new AppError('缺少项目版本。');
      const p = get(id);
      if (patch.revision !== p.revision)
        throw new AppError('项目已在其他窗口更新，请先重新打开项目再保存。', 409);
      if (
        typeof patch.notes === 'string' &&
        patch.notes.length <= 10000 &&
        Object.keys(patch).length === 2
      ) {
        p.notes = patch.notes;
      } else if (
        Number.isInteger(patch.taskIndex) &&
        Number(patch.taskIndex) >= 0 &&
        Number(patch.taskIndex) < p.done.length &&
        typeof patch.done === 'boolean' &&
        Object.keys(patch).length === 3
      ) {
        p.done[Number(patch.taskIndex)] = patch.done;
      } else throw new AppError('仅支持勾选任务或保存 10000 字以内的复盘。');
      return save(p, p.revision);
    },
    remove(id: string, revision: number) {
      get(id);
      if (
        db.prepare('DELETE FROM projects WHERE id = ? AND revision = ?').run(id, revision)
          .changes !== 1
      ) {
        throw new AppError('项目已在其他窗口更新，请重新打开后再删除。', 409);
      }
    },
  };
}
export type Store = ReturnType<typeof openStore>;
