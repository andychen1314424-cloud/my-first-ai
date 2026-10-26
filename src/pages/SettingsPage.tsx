import { useState } from 'react';
import { ConfirmDialog, DevTag, PageHead, Segmented } from '../ui/primitives';
import { useToast } from '../ui/toast';
import { useTheme, type ThemePref } from '../theme';
import { useFinance } from '../finance/FinanceContext';

export function SettingsPage() {
  const { pref, setPref } = useTheme();
  const { snap, resetDemo } = useFinance();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="page narrow">
      <PageHead title="设置" />

      <section className="settings-group">
        <h2 className="h2">外观</h2>
        <div className="card pad">
          <div className="row-between">
            <span>主题</span>
            <Segmented<ThemePref> label="主题" value={pref} onChange={setPref} options={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'system', label: '跟随系统' }]} />
          </div>
        </div>
      </section>

      <section className="settings-group">
        <h2 className="h2">AI 模型</h2>
        <ul className="list card">
          <li className="row"><span className="row-main">当前模型</span><span className="muted">Qwen3（本地 Ollama）</span></li>
          <li className="row"><span className="row-main">连接状态</span><span className="inline"><i className="status-dot off" /> 未连接 <DevTag /></span></li>
          <li className="row"><span className="row-main">切换到千问云端 API</span><DevTag /></li>
        </ul>
        <p className="hint">模型和密钥由后端管理，前端不会保存任何 API Key。</p>
      </section>

      <section className="settings-group">
        <h2 className="h2">数据</h2>
        <div className="card pad row-between">
          <div><p>{snap?.isDemo ? '重置演示数据' : '本地账本'}</p><p className="muted">{snap?.isDemo ? '仅影响本页面的演示数据，恢复到初始状态。' : '财务记录保存到电脑上的 SQLite 数据库，关闭网页后仍会保留。'}</p></div>
          {snap?.isDemo && <button className="btn" onClick={() => setConfirm(true)}>重置</button>}
        </div>
      </section>

      <section className="settings-group">
        <h2 className="h2">键盘快捷键</h2>
        <ul className="list card">
          <li className="row"><span className="row-main">记一笔</span><kbd>N</kbd></li>
          <li className="row"><span className="row-main">发送消息</span><kbd>Enter</kbd></li>
          <li className="row"><span className="row-main">消息换行</span><kbd>Shift + Enter</kbd></li>
          <li className="row"><span className="row-main">关闭弹窗</span><kbd>Esc</kbd></li>
        </ul>
      </section>

      <section className="settings-group">
        <h2 className="h2">关于</h2>
        <ul className="list card">
          <li className="row"><span className="row-main">版本</span><span className="muted">2.0 整合版</span></li>
          <li className="row"><span className="row-main">运行模式</span><span className="muted">{snap?.isDemo ? '演示数据' : '本机 HTTP API + SQLite'}</span></li>
        </ul>
      </section>

      <ConfirmDialog open={confirm} title="重置演示数据？" message="所有演示记录和账户修改会恢复到初始状态。" confirmLabel="重置" danger onConfirm={async () => { await resetDemo(); setConfirm(false); toast('演示数据已重置'); }} onClose={() => setConfirm(false)} />
    </div>
  );
}
