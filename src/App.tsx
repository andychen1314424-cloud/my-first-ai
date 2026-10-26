import { useEffect, useState, type ReactNode } from 'react';
import { FlaskConical, History, LayoutGrid, MessageSquare, Plus, Settings, Wallet } from 'lucide-react';
import { Link, isActive, usePath } from './router';
import { ToastProvider } from './ui/toast';
import { FinanceProvider, useFinance } from './finance/FinanceContext';
import { QuickAddHost } from './finance/QuickAdd';
import { AssistantProvider } from './assistant/AssistantContext';
import { HomePage } from './pages/Home';
import { AssistantPage } from './pages/Assistant';
import { FinancePage } from './pages/Finance';
import { LabPage } from './pages/Lab';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { useTheme } from './theme';

const NAV = [
  { to: '/', label: '首页', icon: LayoutGrid },
  { to: '/assistant', label: 'AI 助手', icon: MessageSquare },
  { to: '/finance', label: 'ZX Finance', short: '财务', icon: Wallet },
  { to: '/lab', label: '项目实验台', short: '实验台', icon: FlaskConical },
  { to: '/history', label: '历史记录', short: '历史', icon: History },
  { to: '/settings', label: '设置', icon: Settings },
];

function Route({ path }: { path: string }): ReactNode {
  if (path.startsWith('/assistant')) return <AssistantPage />;
  if (path.startsWith('/finance')) return <FinancePage />;
  if (path.startsWith('/lab')) return null;
  if (path.startsWith('/history')) return <HistoryPage />;
  if (path.startsWith('/settings')) return <SettingsPage />;
  return <HomePage />;
}

function Shell() {
  const path = usePath();
  const { openQuickAdd } = useFinance();
  const inLab = path.startsWith('/lab');
  const [labVisited, setLabVisited] = useState(inLab);

  // Keep the existing workspace mounted after the first visit so unfinished
  // reflections and in-flight generations survive a switch to another module.
  useEffect(() => { if (inLab) setLabVisited(true); }, [inLab]);

  // 键盘快捷操作：N = 记一笔（非输入状态）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.composedPath().some((el) => el instanceof HTMLElement && el.matches('input,textarea,select,[contenteditable]'));
      if (typing || e.isComposing || e.keyCode === 229 || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openQuickAdd();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openQuickAdd]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path.split('/')[1]]);

  const mobileNav = NAV.filter((n) => n.to !== '/settings');
  return (
    <div className="app" data-route={path.split("/")[1] || "home"}>
      <aside className="sidebar" aria-label="主导航">
        <div className="brand">
          <span className="brand-mark">ZX</span>
          <span>ZX AI</span>
        </div>
        <nav>
          {NAV.filter((n) => n.to !== '/settings').map((n) => (
            <Link key={n.to} to={n.to} className={`nav-item ${isActive(path, n.to) ? 'on' : ''}`} aria-current={isActive(path, n.to) ? 'page' : undefined}>
              <n.icon size={18} aria-hidden />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="btn btn-primary btn-block" onClick={() => openQuickAdd()}>
            <Plus size={16} /> 记一笔 <kbd>N</kbd>
          </button>
          <Link to="/settings" className={`nav-item ${isActive(path, '/settings') ? 'on' : ''}`}>
            <Settings size={18} aria-hidden /> 设置
          </Link>
        </div>
      </aside>

      <header className="mobile-top">
        <span className="brand-mark">ZX</span>
        <span className="mobile-title">ZX AI</span>
        <Link to="/settings" className="icon-btn" aria-label="设置">
          <Settings size={20} />
        </Link>
      </header>

      <main className="main" id="main">
        <div className="route" key={path.split('/')[1] || 'home'}>
          <Route path={path} />
        </div>
        {labVisited && <div className="route" hidden={!inLab}><LabPage /></div>}
      </main>

      <nav className="bottom-nav" aria-label="主导航（手机）">
        {mobileNav.map((n) => (
          <Link key={n.to} to={n.to} className={isActive(path, n.to) ? 'on' : ''} aria-current={isActive(path, n.to) ? 'page' : undefined}>
            <n.icon size={22} aria-hidden />
            <span>{n.short ?? n.label}</span>
          </Link>
        ))}
      </nav>
      <button className="fab" onClick={() => openQuickAdd()} aria-label="记一笔">
        <Plus size={24} />
      </button>
      <QuickAddHost />
    </div>
  );
}

export function App() {
  useTheme();
  return (
    <ToastProvider>
      <FinanceProvider>
        <AssistantProvider>
          <Shell />
        </AssistantProvider>
      </FinanceProvider>
    </ToastProvider>
  );
}
