import { useId } from 'react';

const sanitize = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, '');

function pointsFor(values: number[], width: number, height: number, pad = 2): { x: number; y: number }[] {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  return values.map((v, i) => ({
    x: pad + i * step,
    y: pad + (height - pad * 2) * (1 - (v - min) / span),
  }));
}

function linePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

/** Compact trend line for KPI cards. Pure SVG, no dependency. */
export function Sparkline({ values, color = 'currentColor', height = 34, width = 132 }: { values: number[]; color?: string; height?: number; width?: number }) {
  const id = sanitize(useId());
  const data = values.length > 1 ? values : [0, ...(values.length ? values : [0])];
  const pts = pointsFor(data, width, height);
  const area = `${linePath(pts)} L${width - 2},${height} L2,${height} Z`;
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} />
      <path d={linePath(pts)} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface AreaPoint {
  label: string;
  value: number;
}

/** Revenue/activity area chart with grid, axis labels and a highlighted latest value. */
export function AreaChart({
  points,
  formatValue = (n) => String(Math.round(n)),
  height = 250,
}: {
  points: AreaPoint[];
  formatValue?: (n: number) => string;
  height?: number;
}) {
  const id = sanitize(useId());
  const width = 820;
  const padL = 62;
  const padR = 18;
  const padT = 18;
  const padB = 34;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const values = points.map((p) => p.value);
  const rawMax = Math.max(...values, 1);
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(rawMax)));
  const max = Math.ceil(rawMax / magnitude) * magnitude;
  const step = values.length > 1 ? innerW / (values.length - 1) : 0;
  const coords = points.map((p, i) => ({ x: padL + i * step, y: padT + innerH * (1 - p.value / max) }));
  const path = linePath(coords);
  const area = coords.length ? `${path} L${padL + innerW},${padT + innerH} L${padL},${padT + innerH} Z` : '';
  const last = coords[coords.length - 1];
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="chart-wrap">
      <svg className="area-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Sales trend">
        <defs>
          <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = padT + innerH * f;
          return (
            <g key={f}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} className="chart-grid" />
              <text x={padL - 10} y={y + 4} textAnchor="end" className="chart-axis">
                {formatValue(max * (1 - f))}
              </text>
            </g>
          );
        })}
        {area && <path d={area} fill={`url(#area-${id})`} />}
        {path && <path d={path} className="chart-line" />}
        {last && (
          <>
            <circle cx={last.x} cy={last.y} r="7" className="chart-dot-halo" />
            <circle cx={last.x} cy={last.y} r="3.4" className="chart-dot" />
          </>
        )}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={`${p.label}-${i}`} x={coords[i]!.x} y={height - 10} textAnchor="middle" className="chart-axis">
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

export interface Slice {
  label: string;
  value: number;
  color: string;
}

/** Donut built with conic-gradient; no canvas, no chart library. */
export function Donut({
  slices,
  size = 168,
  centerLabel,
  centerValue,
}: {
  slices: Slice[];
  size?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  let cursor = 0;
  const stops: string[] = [];
  for (const s of slices) {
    const from = total ? (cursor / total) * 100 : 0;
    cursor += s.value;
    const to = total ? (cursor / total) * 100 : 0;
    stops.push(`${s.color} ${from.toFixed(2)}% ${to.toFixed(2)}%`);
  }
  const background = total ? `conic-gradient(${stops.join(', ')})` : 'var(--line)';
  return (
    <div className="donut" style={{ width: size, height: size, background }}>
      <div className="donut-hole">
        {centerValue && <strong>{centerValue}</strong>}
        {centerLabel && <span>{centerLabel}</span>}
      </div>
    </div>
  );
}

/** Horizontal comparison bar used for product and category rankings. */
export function Meter({ value, max, tone = 'primary' }: { value: number; max: number; tone?: 'primary' | 'emerald' | 'amber' }) {
  const pct = max > 0 ? Math.min(100, Math.max(2, (value / max) * 100)) : 0;
  return (
    <span className={`meter meter-${tone}`} aria-hidden="true">
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}
