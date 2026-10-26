import { Link, usePath } from '../router';
import { Banner, DemoTag, ErrorState, PageHead, Skeleton } from '../ui/primitives';
import { useFinance } from '../finance/FinanceContext';
import { Overview } from './finance/Overview';
import { Assets } from './finance/Assets';
import { Transactions } from './finance/Transactions';
import { Budget } from './finance/Budget';
import { Debts } from './finance/Debts';
import { Analysis } from './finance/Analysis';

const TABS = [
  { to: '/finance', label: '总览' },
  { to: '/finance/assets', label: '资产' },
  { to: '/finance/transactions', label: '明细' },
  { to: '/finance/budget', label: '预算' },
  { to: '/finance/debts', label: '负债' },
  { to: '/finance/analysis', label: '分析' },
];

export function FinancePage() {
  const path = usePath();
  const { snap, status, error, reload } = useFinance();
  const sub = path.replace(/^\/finance\/?/, '');

  return (
    <div className="page">
      <PageHead title={<>ZX Finance {snap?.isDemo && <DemoTag />}</>} sub="个人财务，一眼看清" />
      <nav className="tabs" aria-label="财务分区">
        {TABS.map((t) => {
          const on = t.to === path || (t.to === '/finance' && (path === '/finance/' || path === '/finance'));
          return (
            <Link key={t.to} to={t.to} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
              {t.label}
            </Link>
          );
        })}
      </nav>
      {snap?.isDemo && (
        <Banner>
          当前为<b>演示模式</b>：数据为虚构示例，尚未连接后端，刷新页面后恢复初始状态。
        </Banner>
      )}
      {status === 'loading' && !snap && (
        <div className="stack" aria-busy="true">
          <Skeleton h={140} />
          <Skeleton h={96} />
          <Skeleton h={180} />
        </div>
      )}
      {status === 'error' && !snap && <ErrorState message={error} onRetry={reload} />}
      {snap && (
        <>
          {sub === '' && <Overview />}
          {sub === 'assets' && <Assets />}
          {sub === 'transactions' && <Transactions />}
          {sub === 'budget' && <Budget />}
          {sub === 'debts' && <Debts />}
          {sub === 'analysis' && <Analysis />}
        </>
      )}
    </div>
  );
}
