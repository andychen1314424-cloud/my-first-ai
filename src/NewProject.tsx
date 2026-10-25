import { useState } from 'react';
import type { FormEvent } from 'react';
import { buildMessages, LOCAL_MODELS } from '../shared/domain.ts';
import type { Brief, ModelStatus } from '../shared/domain.ts';
import { Icon } from './icons.tsx';

const seeds = [
  {
    title: '学习笔记整理',
    idea: '我想做一个本地学习笔记整理器，把每天学到的知识变成复习卡片。',
    focus: 'coding' as const,
  },
  {
    title: '销售复盘助手',
    idea: '我想把每天的销售记录整理成复盘，找出客户的主要疑问和明天要跟进的事项。',
    focus: 'product' as const,
  },
  {
    title: '文件整理工具',
    idea: '我想做一个工具，预览下载文件夹里的文件分类方案，确认后再按类型整理。',
    focus: 'automation' as const,
  },
];
export function NewProject({
  status,
  refreshing,
  busy,
  generating,
  onGenerate,
  onCancel,
  onExample,
  onRefresh,
}: {
  status: ModelStatus | null;
  refreshing: boolean;
  busy: boolean;
  generating: boolean;
  onGenerate: (brief: Brief) => void;
  onCancel: () => void;
  onExample: () => void;
  onRefresh: () => void;
}) {
  const [brief, setBrief] = useState<Brief>({
    idea: '',
    constraints: '',
    minutesPerDay: 60,
    focus: 'coding',
    model: 'qwen3:1.7b',
  });
  const [showPrompt, setShowPrompt] = useState(false);
  const ready = status?.connected && status.models.includes(brief.model);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onGenerate(brief);
  }
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">BUILD SMALL. LEARN BY DOING.</p>
          <h1>
            今天，做出一点东西<span>。</span>
          </h1>
          <p className="hero-copy">
            把脑海里的想法，变成亲手能完成的小项目。
            <br />
            从第一个可用版本开始，一步一步学会 AI 开发。
          </p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="art-card art-back">
            <span />
            <span />
          </div>
          <div className="art-card art-front">
            <span className="art-logo">
              <Icon name="spark" size={27} />
            </span>
            <b>想法 → 行动</b>
            <span className="art-line" />
            <span className="art-line short" />
            <div className="art-check">
              <Icon name="check" size={14} /> 做成第一步
            </div>
          </div>
          <span className="art-dot" />
        </div>
      </section>
      <div className="workspace-grid">
        <section className="panel brief-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">01 / PROJECT BRIEF</p>
              <h2>先说说，你想做什么？</h2>
            </div>
            <span className="subtle-tag">一个小目标就够了</span>
          </div>
          <form onSubmit={submit}>
            <fieldset disabled={busy || generating}>
              <label htmlFor="idea">
                我的想法 <span className="required">*</span>
              </label>
              <textarea
                id="idea"
                required
                minLength={8}
                maxLength={2000}
                rows={5}
                value={brief.idea}
                onChange={(e) => setBrief({ ...brief, idea: e.target.value })}
                placeholder="比如：我想把每天的学习笔记，自动整理成可以复习的问答卡片……"
              />
              <div className="input-help">
                <span>写清楚：给谁用、输入什么、希望得到什么。</span>
                <span>{brief.idea.length}/2000</span>
              </div>
              <div className="seed-row">
                <span>试试这些</span>
                {seeds.map((seed) => (
                  <button
                    className="seed"
                    type="button"
                    key={seed.title}
                    onClick={() => setBrief({ ...brief, idea: seed.idea, focus: seed.focus })}
                  >
                    {seed.title}
                    <span>↗</span>
                  </button>
                ))}
              </div>
              <div className="form-row">
                <div>
                  <label htmlFor="focus">这次想重点学</label>
                  <select
                    id="focus"
                    value={brief.focus}
                    onChange={(e) =>
                      setBrief({ ...brief, focus: e.target.value as Brief['focus'] })
                    }
                  >
                    <option value="coding">AI 编程 · 从代码到运行</option>
                    <option value="product">产品设计 · 从需求到验收</option>
                    <option value="automation">自动化 · 从输入到输出</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="minutes">每天可以投入</label>
                  <select
                    id="minutes"
                    value={brief.minutesPerDay}
                    onChange={(e) => setBrief({ ...brief, minutesPerDay: Number(e.target.value) })}
                  >
                    {[15, 30, 60, 90, 120, 180, 240].map((n) => (
                      <option value={n} key={n}>
                        {n} 分钟
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label htmlFor="constraints">
                补充限制 <span className="optional">选填</span>
              </label>
              <input
                id="constraints"
                maxLength={1000}
                value={brief.constraints}
                onChange={(e) => setBrief({ ...brief, constraints: e.target.value })}
                placeholder="比如：零基础、只给自己用、希望离线运行"
              />
              <label htmlFor="model" className="model-label">
                使用本地模型
              </label>
              <select
                id="model"
                value={brief.model}
                onChange={(e) => setBrief({ ...brief, model: e.target.value as Brief['model'] })}
              >
                {LOCAL_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m} · {status?.models.includes(m) ? '已安装' : '待下载'}
                  </option>
                ))}
              </select>
            </fieldset>
            {generating ? (
              <div className="generation" role="status">
                <span className="spinner" />
                <span>
                  <b>本地 AI 正在拆解想法…</b>
                  <small>首次加载可能较慢，最多等待 3 分钟。</small>
                </span>
                <button type="button" className="button ghost" onClick={onCancel}>
                  取消生成
                </button>
              </div>
            ) : (
              <div className="form-footer">
                <span>
                  <Icon name="lock" size={15} /> 输入仅发送给本机 Ollama
                </span>
                <button
                  type="submit"
                  className="button primary"
                  disabled={!ready || busy || brief.idea.trim().length < 8}
                >
                  <Icon name="spark" size={18} />
                  生成我的项目
                  <Icon name="arrow" size={17} />
                </button>
              </div>
            )}
            {!ready && !generating && (
              <p className="inline-hint">
                生成前，请在右侧完成本地模型连接。也可以先查看教学示例。
              </p>
            )}
          </form>
          <button
            className="prompt-toggle"
            type="button"
            onClick={() => setShowPrompt(!showPrompt)}
            aria-expanded={showPrompt}
          >
            <Icon name="code" size={16} />
            {showPrompt ? '收起提示词' : '看看这个功能背后的提示词'}
            <span>{showPrompt ? '−' : '+'}</span>
          </button>
          {showPrompt && (
            <div className="prompt-box">
              <p>这就是提交时发给本地模型的内容。返回结果还会经过结构校验，再保存为项目。</p>
              <pre>{JSON.stringify(buildMessages(brief), null, 2)}</pre>
            </div>
          )}
        </section>
        <aside className="guide-column">
          <section className="panel connection-panel">
            <div className="section-heading">
              <h3>本地 AI 连接</h3>
              <span className={`status-dot ${status?.models.length ? 'online' : ''}`} />
            </div>
            <p className="connection-status">{status ? status.message : '正在检测 Ollama…'}</p>
            <ol className="setup-steps">
              <li>
                安装并启动{' '}
                <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
                  Ollama ↗
                </a>
              </li>
              <li>
                在终端下载入门模型<code>ollama pull qwen3:1.7b</code>
              </li>
              <li>下载完成后，刷新连接</li>
            </ol>
            <button
              type="button"
              className="button secondary full"
              onClick={onRefresh}
              disabled={refreshing || generating}
            >
              <Icon name="refresh" size={16} />
              {refreshing ? '检测中…' : '刷新连接'}
            </button>
            <p className="tiny">
              首次安装和下载需要网络。模型就绪后，可断网使用。建议在 Ollama 设置中关闭云功能。
            </p>
          </section>
          <section className="journey-panel">
            <p className="eyebrow">从想法，到第一个作品</p>
            <div className="journey-step">
              <span>1</span>
              <div>
                <h3>缩小范围</h3>
                <p>明确第一版真正需要的功能</p>
              </div>
            </div>
            <div className="journey-step">
              <span>2</span>
              <div>
                <h3>拆成行动</h3>
                <p>每一步都有操作和验收标准</p>
              </div>
            </div>
            <div className="journey-step">
              <span>3</span>
              <div>
                <h3>完成，再复盘</h3>
                <p>把做过的东西变成自己的经验</p>
              </div>
            </div>
          </section>
          <button
            className="example-button"
            type="button"
            onClick={onExample}
            disabled={busy || generating}
          >
            <span className="example-icon">
              <Icon name="folder" />
            </span>
            <span>
              <b>先看看一个完成的方案</b>
              <small>人工教学示例 · 无需模型</small>
            </span>
            <Icon name="arrow" size={18} />
          </button>
        </aside>
      </div>
    </>
  );
}
