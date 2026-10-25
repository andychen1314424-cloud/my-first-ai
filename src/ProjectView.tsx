import type { Project } from '../shared/domain.ts';
import { Icon } from './icons.tsx';

export function ProjectView({
  project: p,
  notes,
  onNotes,
  busy,
  onToggle,
  onSave,
  onDelete,
  onBack,
  onExport,
}: {
  project: Project;
  notes: string;
  onNotes: (s: string) => void;
  busy: boolean;
  onToggle: (index: number, done: boolean) => void;
  onSave: () => void;
  onDelete: () => void;
  onBack: () => void;
  onExport: () => void;
}) {
  const completed = p.done.filter(Boolean).length;
  const totalMinutes = p.plan.tasks.reduce((sum, task) => sum + task.minutes, 0);
  const dirty = notes !== p.notes;
  return (
    <>
      <button className="back-button" onClick={onBack} disabled={busy}>
        <Icon name="arrowLeft" size={16} />
        新建另一个项目
      </button>
      <section className="project-heading">
        <div>
          <p className="eyebrow">MY PROJECT / 从计划到行动</p>
          <h1>{p.plan.title}</h1>
          <p>{p.plan.summary}</p>
        </div>
        <button className="button secondary" onClick={onExport} disabled={busy || dirty}>
          <Icon name="download" size={17} />
          导出 Markdown
        </button>
      </section>
      <div className={`source-banner ${p.source === 'example' ? 'example-banner' : ''}`}>
        <Icon name={p.source === 'example' ? 'folder' : 'lock'} size={17} />
        <span>
          {p.source === 'example'
            ? '人工教学示例 · 非 AI 生成，可自由勾选和记录复盘'
            : `本地 AI 生成 · ${p.brief.model} · 用时 ${(p.durationMs / 1000).toFixed(1)} 秒，请自行检查计划的可行性`}
        </span>
      </div>
      <div className="project-stats">
        <div>
          <span>完成进度</span>
          <b>
            {completed}
            <small> / {p.done.length}</small>
          </b>
        </div>
        <div>
          <span>预计投入</span>
          <b>
            {totalMinutes}
            <small> 分钟</small>
          </b>
        </div>
        <div>
          <span>按每天 {p.brief.minutesPerDay} 分钟</span>
          <b>
            {Math.ceil(totalMinutes / p.brief.minutesPerDay)}
            <small> 天左右</small>
          </b>
        </div>
        <div className="progress-stat">
          <span>
            {completed === p.done.length ? '这一轮完成了，记得复盘。' : '只专注眼前的下一步'}
          </span>
          <progress value={completed} max={p.done.length} aria-label="项目完成进度" />
        </div>
      </div>
      <div className="workspace-grid result-grid">
        <div>
          <section className="panel tasks-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">02 / ACTION PLAN</p>
                <h2>一步一步，把它做出来</h2>
              </div>
              <span className="subtle-tag">勾选后自动保存</span>
            </div>
            <div className="task-list">
              {p.plan.tasks.map((t, i) => (
                <article key={i} className={`task ${p.done[i] ? 'task-done' : ''}`}>
                  <label className="task-check">
                    <input
                      type="checkbox"
                      checked={p.done[i]}
                      onChange={(e) => onToggle(i, e.target.checked)}
                      disabled={busy}
                      aria-label={`完成任务：${t.title}`}
                    />
                    <span>
                      {p.done[i] ? <Icon name="check" size={14} /> : String(i + 1).padStart(2, '0')}
                    </span>
                  </label>
                  <div className="task-content">
                    <div className="task-title">
                      <h3>{t.title}</h3>
                      <span>约 {t.minutes} 分钟</span>
                    </div>
                    <p>{t.action}</p>
                    <div className="acceptance">
                      <b>怎样算完成</b>
                      <p>{t.acceptance}</p>
                    </div>
                    <p className="learning">
                      <Icon name="code" size={14} />
                      <span>你会学到：{t.learn}</span>
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </section>
          <section className="panel notes-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">03 / REFLECTION</p>
                <h2>把经验留下来</h2>
              </div>
              <span className="save-state">{dirty ? '有未保存内容' : '已保存'}</span>
            </div>
            <label className="sr-only" htmlFor="notes">
              项目复盘
            </label>
            <textarea
              id="notes"
              rows={5}
              maxLength={10000}
              disabled={busy}
              value={notes}
              onChange={(e) => onNotes(e.target.value)}
              placeholder="今天完成了什么？哪里卡住了？你是怎么解决的？下一次可以怎样改进？"
            />
            <div className="notes-footer">
              <small>{notes.length}/10000 · 导出前请先保存复盘</small>
              <button className="button primary" onClick={onSave} disabled={busy || !dirty}>
                保存复盘
              </button>
            </div>
          </section>
        </div>
        <aside className="guide-column">
          <section className="panel scope-panel">
            <p className="eyebrow">MVP / 先做这些</p>
            <h3>第一版的边界</h3>
            <ul>
              {p.plan.scope.map((s, i) => (
                <li key={i}>
                  <Icon name="check" size={15} />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel assumptions-panel">
            <h3>需要你确认</h3>
            {p.plan.assumptions.length ? (
              <ul>
                {p.plan.assumptions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            ) : (
              <p>暂无列出。开始前，仍请检查任务是否符合你的实际条件。</p>
            )}
          </section>
          <section className="panel next-panel">
            <h3>做完以后，再考虑</h3>
            <ol>
              {p.plan.nextIdeas.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </section>
          <details className="panel original">
            <summary>原始需求与提示词</summary>
            <p>{p.brief.idea}</p>
            <p>{p.brief.constraints || '未补充限制'}</p>
            <p>
              {p.prompt.version}
              {p.source === 'example' ? ' · 参考提示词，示例未调用模型' : ' · 生成时的提示词快照'}
            </p>
            <pre>{JSON.stringify(p.prompt.messages, null, 2)}</pre>
          </details>
          <button className="delete-button" onClick={onDelete} disabled={busy}>
            <Icon name="trash" size={15} />
            删除这个项目
          </button>
        </aside>
      </div>
    </>
  );
}
