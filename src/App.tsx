import { useEffect, useRef, useState } from 'react';
import type { Brief, ModelStatus, Project, Summary } from '../shared/domain.ts';
import { api } from './api.ts';
import { Icon } from './icons.tsx';
import { NewProject } from './NewProject.tsx';
import { ProjectView } from './ProjectView.tsx';

function summary(p: Project): Summary {
  return {
    id: p.id,
    title: p.plan.title,
    source: p.source,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    total: p.done.length,
    completed: p.done.filter(Boolean).length,
  };
}
export default function App() {
  const [projects, setProjects] = useState<Summary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const controller = useRef<AbortController | null>(null);
  const dirty = !!project && notes !== project.notes;
  const blocked = busy || generating;

  async function refresh() {
    setRefreshing(true);
    try {
      setStatus(await api<ModelStatus>('/models'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    void api<Summary[]>('/projects')
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
    void refresh();
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (dirty || generating) event.preventDefault();
    };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty, generating]);

  function remember(p: Project) {
    setProject(p);
    setProjects((previous) => [summary(p), ...previous.filter((s) => s.id !== p.id)]);
  }
  function canLeave() {
    return !dirty || window.confirm('复盘还有未保存的内容。确定放弃这些修改吗？');
  }
  function newProject() {
    if (!blocked && canLeave()) {
      setProject(null);
      setNotes('');
      setError('');
      setNotice('');
    }
  }
  async function open(id: string) {
    if (blocked || !canLeave()) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const p = await api<Project>(`/projects/${id}`);
      setProject(p);
      setNotes(p.notes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function example() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const p = await api<Project>('/examples', 'POST', {});
      remember(p);
      setNotes(p.notes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generate(brief: Brief) {
    if (blocked) return;
    const abort = new AbortController();
    controller.current = abort;
    setGenerating(true);
    setError('');
    setNotice('');
    try {
      const p = await api<Project>('/projects', 'POST', brief, abort.signal);
      remember(p);
      setNotes(p.notes);
      setNotice('项目已生成并保存到本地。');
    } catch (e) {
      if (abort.signal.aborted) {
        setNotice('已停止等待。若取消前已完成保存，项目会出现在历史列表中。');
        try {
          setProjects(await api<Summary[]>('/projects'));
        } catch {
          /* Keep the last successful history. */
        }
      } else setError((e as Error).message);
    } finally {
      setGenerating(false);
      controller.current = null;
    }
  }
  async function update(patch: Record<string, unknown>) {
    if (!project || blocked) return;
    const previous = project;
    setBusy(true);
    setError('');
    setNotice('');
    if (typeof patch.taskIndex === 'number' && typeof patch.done === 'boolean') {
      setProject({
        ...previous,
        done: previous.done.map((done, index) =>
          index === patch.taskIndex ? (patch.done as boolean) : done,
        ),
      });
    }
    try {
      const p = await api<Project>(`/projects/${project.id}`, 'PATCH', {
        revision: project.revision,
        ...patch,
      });
      remember(p);
      if ('notes' in patch) {
        setNotes(p.notes);
        setNotice('复盘已保存。');
      }
    } catch (e) {
      setProject(previous);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !project ||
      blocked ||
      !window.confirm('确定删除这个项目及其复盘吗？删除后无法恢复，建议先导出。')
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api(`/projects/${project.id}`, 'DELETE', { revision: project.revision });
      setProjects((previous) => previous.filter((p) => p.id !== project.id));
      setProject(null);
      setNotes('');
      setNotice('项目已删除。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportProject() {
    if (!project || dirty || blocked) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/projects/${project.id}/export`);
      if (!response.ok) throw new Error('导出失败，请重新打开项目后重试。');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `zx-project-${project.id}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Markdown 已导出。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const visible = projects.filter((p) => p.title.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            newProject();
          }}
          aria-label="ZX Ai 首页"
        >
          <span className="brand-mark">
            ZX<span>·</span>
          </span>
          <span>
            <b>ZX Ai</b>
            <small>个人项目实验台</small>
          </span>
        </a>
        <button
          className={`new-button ${!project ? 'active' : ''}`}
          onClick={newProject}
          disabled={blocked}
        >
          <Icon name="plus" size={18} />
          开启一个新想法<span>↗</span>
        </button>
        <div className="history-label">
          <span>我的项目</span>
          <span>{projects.length}</span>
        </div>
        {projects.length > 0 && (
          <input
            className="search"
            type="search"
            aria-label="搜索项目"
            placeholder="搜索项目…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        <nav className="project-nav" aria-label="项目历史">
          {visible.map((p) => (
            <button
              key={p.id}
              className={`history-item ${project?.id === p.id ? 'selected' : ''}`}
              onClick={() => void open(p.id)}
              disabled={blocked}
            >
              <Icon name="folder" size={17} />
              <span>
                <b>{p.title}</b>
                <small>
                  {p.source === 'example' ? '教学示例 · ' : ''}
                  {p.completed}/{p.total} 已完成
                </small>
              </span>
            </button>
          ))}
          {projects.length === 0 && (
            <div className="empty-history">
              <Icon name="folder" size={27} />
              <p>
                第一个作品
                <br />
                从一个小想法开始
              </p>
            </div>
          )}
          {projects.length > 0 && !visible.length && (
            <p className="empty-search">没有找到匹配的项目</p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <Icon name="lock" size={15} />
            <span>LOCAL FIRST</span>
            <i />
          </div>
          <p>你的想法，留在你的电脑。</p>
          <div className="version">
            <span>AI 技术与效率实验室</span>
            <span>v0.1</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span>我的工作台</span>
            <span className="breadcrumb">/</span>
            <b>{project ? '项目详情' : '新建项目'}</b>
          </div>
          <span className="top-status">
            <span className={`status-dot ${status?.models.length ? 'online' : ''}`} />
            {status?.models.length ? '本地 AI 已连接' : '本地工作空间'}
          </span>
        </header>
        <main>
          {error && (
            <div className="message error" role="alert">
              <span>{error}</span>
              <button onClick={() => setError('')} aria-label="关闭错误提示">
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="message notice" role="status">
              <span>{notice}</span>
              <button onClick={() => setNotice('')} aria-label="关闭提示">
                ×
              </button>
            </div>
          )}
          {project ? (
            <ProjectView
              project={project}
              notes={notes}
              onNotes={setNotes}
              busy={blocked}
              onToggle={(taskIndex, done) => void update({ taskIndex, done })}
              onSave={() => void update({ notes })}
              onDelete={() => void remove()}
              onBack={newProject}
              onExport={() => void exportProject()}
            />
          ) : (
            <NewProject
              status={status}
              refreshing={refreshing}
              busy={busy}
              generating={generating}
              onGenerate={(brief) => void generate(brief)}
              onCancel={() => controller.current?.abort()}
              onExample={() => void example()}
              onRefresh={() => void refresh()}
            />
          )}
          <footer className="page-footer">
            <span>小步实践，比空想更接近答案。</span>
            <span>ZX Ai / 知行合一</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
