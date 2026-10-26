import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import css from './lab.css?inline';

// The legacy workspace owns its own CSS tree. Global rules in either UI cannot
// style the other UI, and the open root stays accessible to browser automation.
const embedded = `
:host { display: block; min-width: 0; color: var(--text); background: var(--bg); --paper: var(--surface); --line: var(--border); --muted: var(--text-2); --green: var(--accent); }
.app-shell { min-height: 0; display: grid; grid-template-columns: 190px minmax(0, 1fr); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.sidebar { position: static; width: auto; padding: 20px 12px; min-width: 0; background: var(--surface); }
.brand { margin: 0 4px 20px; }
.brand small { font-size: 10px; }
.main-shell { min-width: 0; width: auto; margin-left: 0; }
.topbar { padding: 16px 20px; height: auto; }
main { padding: 20px; }
.hero { padding: 0; margin-bottom: 24px; }
.hero h1 { font-size: 28px; }
.hero-art { display: none; }
.workspace-grid { grid-template-columns: minmax(0, 1fr); }
.guide-column { display: grid; grid-template-columns: minmax(0, 1fr); }
.hero-copy { max-width: none; }
.sidebar-bottom { margin-top: 24px; }
.topbar, .panel, input, textarea, select, .project-stats > div, .task { background: var(--surface); color: var(--text); border-color: var(--border); }
.topbar b, .section-heading h2, .project-heading h1, .task-title h3, label { color: var(--text); }
.hero-copy, .hero h1, .source-banner, .history-item { color: var(--text); }
.history-item.selected, .history-item:not(:disabled):hover, .seed, .prompt-toggle, .prompt-box, .acceptance, .task-done { background: var(--surface-2); color: var(--text-2); }
.button.secondary, .new-button { background: var(--surface-2); color: var(--text); border-color: var(--border); }
.button.primary { background: var(--accent); color: var(--accent-ink); }
.source-banner { background: var(--accent-soft); border-color: var(--border); }
@media (max-width: 1100px) {
  .app-shell { grid-template-columns: minmax(0, 1fr); }
  .sidebar { position: static; width: auto; max-height: 300px; overflow: auto; border-right: 0; border-bottom: 1px solid var(--line); }
  .brand, .empty-history, .sidebar-bottom, .history-label { display: none; }
  .project-nav { max-height: 140px; }
  .main-shell { margin-left: 0; }
}
@media (max-width: 650px) { main { padding: 16px; } .topbar { padding: 12px 16px; } .hero h1 { font-size: 25px; } }
`;

export function LabFrame({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  useEffect(() => {
    if (host.current) setRoot(host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' }));
  }, []);
  return <div className="lab-host" ref={host}>{root && createPortal(<><style>{css + embedded}</style>{children}</>, root)}</div>;
}
