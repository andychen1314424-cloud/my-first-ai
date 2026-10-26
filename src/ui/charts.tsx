import { yuan } from '../finance/money';

export interface Part {
  label: string;
  value: number;
}

/** 堆叠横条：展示构成占比（单色系，避免彩色堆砌） */
export function StackedBar({ parts }: { parts: Part[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div>
      <div className="stack-bar" role="img" aria-label={parts.map((p) => `${p.label} ${yuan(p.value)}`).join('，')}>
        {parts.map((p, i) =>
          p.value > 0 ? <span key={p.label} className={`seg seg-${i}`} style={{ flexGrow: p.value }} title={`${p.label} ${yuan(p.value)}`} /> : null,
        )}
      </div>
      <ul className="legend">
        {parts.map((p, i) => (
          <li key={p.label}>
            <i className={`dot seg-${i}`} />
            <span>{p.label}</span>
            <b>{total ? Math.round((p.value / total) * 100) : 0}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 横向条形列表：支出分类 */
export function HBars({ rows }: { rows: { id: string; label: string; value: number; max?: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.max ?? r.value));
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.id}>
          <div className="hbars-top">
            <span>{r.label}</span>
            <span className="num">
              {yuan(r.value)} <em>{total ? Math.round((r.value / total) * 100) : 0}%</em>
            </span>
          </div>
          <div className="track">
            <span style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** 月度收入/支出柱状图（纯 SVG，无图表库依赖） */
export function TrendBars({ data }: { data: { month: string; income: number; expense: number }[] }) {
  const W = 600;
  const H = 220;
  const pad = { l: 44, r: 8, t: 12, b: 28 };
  const rawMax = Math.max(100000, ...data.flatMap((d) => [d.income, d.expense]));
  const step = rawMax > 2000000 ? 1000000 : rawMax > 600000 ? 500000 : 200000;
  const max = Math.ceil(rawMax / step) * step;
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);
  const innerH = H - pad.t - pad.b;
  const innerW = W - pad.l - pad.r;
  const gw = innerW / data.length;
  const bw = Math.min(18, gw / 3);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const label = (c: number) => (c === 0 ? '0' : c >= 1000000 ? `${c / 1000000}万` : `${c / 100 / 1000}千`);
  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="近六个月收入与支出">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
          <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="axis">
            {label(t)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx = pad.l + gw * i + gw / 2;
        return (
          <g key={d.month}>
            <rect x={cx - bw - 2} y={y(d.income)} width={bw} height={pad.t + innerH - y(d.income)} rx={3} className="bar-income" />
            <rect x={cx + 2} y={y(Math.max(0, d.expense))} width={bw} height={pad.t + innerH - y(Math.max(0, d.expense))} rx={3} className="bar-expense" />
            <text x={cx} y={H - 8} textAnchor="middle" className="axis">
              {Number(d.month.slice(5))}月
            </text>
          </g>
        );
      })}
    </svg>
  );
}
