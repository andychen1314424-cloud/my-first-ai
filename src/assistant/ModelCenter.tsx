import { Check, Copy, RefreshCw } from 'lucide-react';
import { useAssistant } from './AssistantContext';
import { useToast } from '../ui/toast';
import type { AIModel } from '../../shared/chat';

type Download = { completed: number; total: number; status: string };
const progressOf = (m: AIModel) => (m as AIModel & { download?: Download }).download;
export const modelState = (m: AIModel) => progressOf(m) && !m.available ? '下载中' : m.available ? '可使用' : m.status === 'unavailable' ? '服务不可用' : '未安装';
const gigabytes = (n: number) => `${(n / 1e9).toFixed(2)} GB`;

export function ModelPicker({ compact = false }: { compact?: boolean }) {
  const { aiStatus, selectedModelId, selectedModel, selectModel, pending } = useAssistant();
  return (
    <label className={`model-picker ${compact ? 'compact' : ''}`}>
      <span className={compact ? 'sr-only' : 'label'}>选择本地模型</span>
      <select aria-label="选择本地模型" value={selectedModelId} onChange={(e) => selectModel(e.target.value)} disabled={!!pending}>
        {aiStatus.models.map((m) => <option key={m.id} value={m.id} disabled={!m.available}>{m.name}{m.available ? '' : `（${modelState(m)}）`}</option>)}
      </select>
      {!compact && <span className="hint">{selectedModel?.detail || '请刷新模型状态。'}</span>}
    </label>
  );
}

export function ModelCenter() {
  const { aiStatus, modelsLoading, modelError, refreshModels, selectedModelId, selectModel, pending } = useAssistant();
  const toast = useToast();
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('安装命令已复制，请在本机终端运行。'); }
    catch { toast('复制不可用，请选中安装命令手动复制。'); }
  };
  return (
    <section className="settings-group model-center" aria-label="本地模型中心">
      <div className="row-between">
        <h2 className="h2">本地模型中心</h2>
        <button className="btn btn-sm" onClick={() => void refreshModels()} disabled={modelsLoading}><RefreshCw size={14} />{modelsLoading ? '检查中…' : '刷新状态'}</button>
      </div>
      <p className="muted inline"><i className={`status-dot ${aiStatus.connected ? '' : 'off'}`} />{aiStatus.message}</p>
      {modelError && <p className="field-error" role="alert">{modelError}</p>}
      <div className="model-groups">
        {(['Qwen', 'DeepSeek', 'Kimi'] as const).map((family) => (
          <section key={family} className="model-family">
            <h3>{family}</h3>
            {aiStatus.models.filter((m) => m.family === family).map((m) => {
              const download = progressOf(m);
              const percentage = download?.total ? Math.max(0, Math.min(100, download.completed / download.total * 100)) : 0;
              return (
                <article key={m.id} className={`card model-card ${m.id === selectedModelId ? 'selected' : ''}`}>
                  <div className="row-between model-card-head"><strong>{m.name}</strong><span className={`model-state ${m.available ? 'ready' : ''}`}>{modelState(m)}</span></div>
                  <p className="muted">{m.detail}</p>
                  <code className="model-id">{m.id}</code>
                  {m.sizeBytes !== undefined && <p className="hint">本地权重 {gigabytes(m.sizeBytes)}</p>}
                  {download && <div className="model-download"><progress aria-label={`${m.name} 下载进度`} value={percentage} max={100} /><span className="muted">{download.status} · {gigabytes(download.completed)} / {gigabytes(download.total)}{download.total > 0 ? ` · ${percentage.toFixed(1)}%` : ''}</span></div>}
                  <div className="model-card-actions">
                    <button className="btn btn-sm" disabled={!m.available || !!pending} onClick={() => selectModel(m.id)}>{m.id === selectedModelId ? <><Check size={14} />当前选择</> : '使用此模型'}</button>
                    {!m.installed && m.installCommand && <button className="btn btn-sm" onClick={() => void copy(m.installCommand!)}><Copy size={14} />复制安装命令</button>}
                  </div>
                  {!m.installed && m.installCommand && <code className="model-command">{m.installCommand}</code>}
                </article>
              );
            })}
          </section>
        ))}
      </div>
      <p className="hint">只调用这台电脑上的 Ollama。云端 API 已关闭，无付费回退。下载完成后刷新状态，才能选择模型。</p>
    </section>
  );
}
