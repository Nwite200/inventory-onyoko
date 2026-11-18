import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatMoney } from '../config';
import { listLocations } from '../location';
import { loadDashboard, percentChange, RANGES } from '../analytics';
import { serverMode } from '../auth';
import { Icon } from '../components/Icon';
import { AreaChart, Donut, Meter, Sparkline } from '../components/charts';

interface HomeProps {
  onNavigate: (tab: string) => void;
  canManage: boolean;
}

const PAY_COLORS: Record<string, string> = {
  cash: '#4f46e5',
  transfer: '#0ea5e9',
  card: '#10b981',
  pos: '#8b5cf6',
  credit: '#f59e0b',
  split: '#64748b',
};

function Trend({ change }: { change: number | null }) {
  if (change === null) return <span className="trend flat">New</span>;
  const up = change >= 0;
  return (
    <span className={`trend ${up ? 'up' : 'down'}`}>
      <Icon name={up ? 'trendUp' : 'trendDown'} size={13} />
      {Math.abs(change).toFixed(1)}%
    </span>
  );
}

export function Home({ onNavigate, canManage }: HomeProps) {
  const [days, setDays] = useState<number>(7);
  const [locationId, setLocationId] = useState<string>('all');
  const locations = useLiveQuery(() => listLocations(), [], []);
  const pendingDb = useLiveQuery(() => db.outbox.count(), [], 0);
  const pending = serverMode() ? pendingDb : 0;

  const stats = useLiveQuery(
    () => loadDashboard(days, locationId === 'all' ? null : locationId),
    [days, locationId],
  );

  const money = (n: number) => formatMoney(Math.round(n * 100) / 100);
  const compact = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}m` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(Math.round(n));
  const fmtDate = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const margin = stats && stats.revenue > 0 ? (stats.grossProfit / stats.revenue) * 100 : 0;
  const revenueChange = stats ? percentChange(stats.revenue, stats.previousRevenue) : null;
  const spark = stats?.series.map((p) => p.value) ?? [];
  const payTotal = stats?.paymentMix.reduce((s, p) => s + p.total, 0) ?? 0;
  const netCash = (stats?.cashIn ?? 0) - (stats?.cashOut ?? 0);

  return (
    <div className="dashboard">
      <header className="page-head">
        <div>
          <span className="eyebrow">Business overview</span>
          <h1>Good to see you.</h1>
          <p className="lede">
            Live figures from this device{locationId === 'all' ? ' across all branches' : ''}.
            {pending > 0 && <> <span className="inline-warn">{pending} change{pending === 1 ? '' : 's'} waiting to sync.</span></>}
          </p>
        </div>
        <div className="page-head-actions">
          {locations.length > 1 && (
            <label className="select-wrap">
              <Icon name="store" size={15} />
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label="Filter by branch">
                <option value="all">All branches</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </label>
          )}
          <div className="segmented" role="group" aria-label="Date range">
            {RANGES.map((r) => (
              <button key={r.days} className={days === r.days ? 'active' : ''} onClick={() => setDays(r.days)}>
                {r.label}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={() => onNavigate('pos')}>
            <Icon name="pos" size={16} /> New sale
          </button>
        </div>
      </header>

      {!stats ? (
        <div className="skeleton-grid">
          {Array.from({ length: 4 }, (_, i) => <div className="skeleton-card" key={i} />)}
        </div>
      ) : (
        <>
          <section className="kpi-grid">
            <article className="kpi-card">
              <div className="kpi-top">
                <span className="kpi-label">Gross sales</span>
                <span className="kpi-ico"><Icon name="banknote" size={16} /></span>
              </div>
              <div className="kpi-value">{money(stats.revenue)}</div>
              <div className="kpi-foot">
                <Trend change={revenueChange} />
                <span className="kpi-context">vs previous {days === 1 ? 'day' : `${days} days`}</span>
              </div>
              <Sparkline values={spark} color="var(--primary)" />
            </article>

            {canManage ? (
              <>
                <article className="kpi-card">
                  <div className="kpi-top">
                    <span className="kpi-label">Gross profit</span>
                    <span className="kpi-ico ico-emerald"><Icon name="trendUp" size={16} /></span>
                  </div>
                  <div className="kpi-value">{money(stats.grossProfit)}</div>
                  <div className="kpi-foot">
                    <span className="ratio">{margin.toFixed(1)}% margin</span>
                    <span className="kpi-context">COGS {money(stats.cogs)}</span>
                  </div>
                  <Sparkline values={spark.map((v) => v * (margin / 100))} color="#059669" />
                </article>

                <article className="kpi-card">
                  <div className="kpi-top">
                    <span className="kpi-label">Net profit</span>
                    <span className="kpi-ico ico-amber"><Icon name="wallet" size={16} /></span>
                  </div>
                  <div className="kpi-value">{money(stats.netProfit)}</div>
                  <div className="kpi-foot">
                    <span className={`ratio ${stats.netProfit < 0 ? 'neg' : ''}`}>{stats.netProfit < 0 ? 'Loss' : 'Profit'}</span>
                    <span className="kpi-context">after {money(stats.expenses)} expenses</span>
                  </div>
                  <Sparkline values={spark.map((v) => v * (stats.netProfit / Math.max(stats.revenue, 1)))} color="#d97706" />
                </article>
              </>
            ) : (
              <article className="kpi-card">
                <div className="kpi-top">
                  <span className="kpi-label">Transactions</span>
                  <span className="kpi-ico ico-emerald"><Icon name="receipt" size={16} /></span>
                </div>
                <div className="kpi-value">{stats.salesCount}</div>
                <div className="kpi-foot">
                  <span className="ratio">Today {stats.todayCount}</span>
                  <span className="kpi-context">{money(stats.todayRevenue)} today</span>
                </div>
                <Sparkline values={spark} color="#059669" />
              </article>
            )}

            <article className="kpi-card">
              <div className="kpi-top">
                <span className="kpi-label">Cash position</span>
                <span className="kpi-ico ico-sky"><Icon name="register" size={16} /></span>
              </div>
              <div className="kpi-value">{money(netCash)}</div>
              <div className="kpi-foot">
                <span className="ratio">In {money(stats.cashIn)}</span>
                <span className="kpi-context">out {money(stats.cashOut)}</span>
              </div>
              <Sparkline values={[stats.cashOut, stats.cashIn]} color="#0ea5e9" height={34} />
            </article>
          </section>

          <section className="dashboard-main">
            <article className="panel">
              <header className="panel-head">
                <div>
                  <h3>Sales performance</h3>
                  <p className="panel-sub">
                    {stats.salesCount} transaction{stats.salesCount === 1 ? '' : 's'} · {money(stats.todayRevenue)} today
                  </p>
                </div>
                <div className="panel-tools">
                  <span className="legend-dot" style={{ background: 'var(--primary)' }} /> Sales
                </div>
              </header>
              {stats.revenue === 0 ? (
                <div className="empty-state">
                  <span className="empty-ico"><Icon name="chart" size={22} /></span>
                  <strong>No sales in this period</strong>
                  <p>Start a sale from the POS, or widen the date range.</p>
                  <button className="btn btn-primary btn-sm" onClick={() => onNavigate('pos')}>Open POS</button>
                </div>
              ) : (
                <AreaChart points={stats.series} formatValue={compact} />
              )}
              <footer className="panel-foot">
                <span><span className="legend-dot" style={{ background: 'var(--primary)' }} /> Sales</span>
                <span className="muted">Excludes {money(stats.returnsTotal)} refunded</span>
              </footer>
            </article>

            <article className="panel">
              <header className="panel-head">
                <div>
                  <h3>Payment mix</h3>
                  <p className="panel-sub">How customers paid</p>
                </div>
              </header>
              {payTotal === 0 ? (
                <div className="empty-state compact"><p>No payments yet.</p></div>
              ) : (
                <>
                  <div className="donut-block">
                    <Donut
                      size={158}
                      slices={stats.paymentMix.map((p) => ({ label: p.method, value: p.total, color: PAY_COLORS[p.method] ?? '#64748b' }))}
                      centerValue={money(payTotal)}
                      centerLabel="collected"
                    />
                    <ul className="legend-list">
                      {stats.paymentMix.map((p) => (
                        <li key={p.method}>
                          <span className="legend-dot" style={{ background: PAY_COLORS[p.method] ?? '#64748b' }} />
                          <span className="legend-name">{p.method}</span>
                          <span className="legend-value">{Math.round((p.total / payTotal) * 100)}%</span>
                          <span className="legend-amount">{money(p.total)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="panel-foot">
                    <span className="muted">{stats.paymentMix.reduce((s, p) => s + p.count, 0)} payment{stats.paymentMix.reduce((s, p) => s + p.count, 0) === 1 ? '' : 's'}</span>
                    <button className="link-btn" onClick={() => onNavigate('reports')}>Reports <Icon name="arrowRight" size={13} /></button>
                  </div>
                </>
              )}
            </article>
          </section>

          <section className="dashboard-three">
            <article className="panel">
              <header className="panel-head">
                <div>
                  <h3>Best sellers</h3>
                  <p className="panel-sub">By revenue this period</p>
                </div>
                <button className="link-btn" onClick={() => onNavigate('products')}>Catalog <Icon name="arrowRight" size={13} /></button>
              </header>
              {stats.topProducts.length === 0 ? (
                <div className="empty-state compact"><p>No products sold yet.</p></div>
              ) : (
                <ul className="rank-list">
                  {stats.topProducts.map((p, i) => (
                    <li key={p.id}>
                      <span className="rank">{i + 1}</span>
                      <span className="rank-name">
                        {p.name}
                        <small>{p.qty} unit{p.qty === 1 ? '' : 's'}</small>
                      </span>
                      <Meter value={p.revenue} max={stats.topProducts[0]!.revenue} tone={i === 0 ? 'emerald' : 'primary'} />
                      <span className="rank-value">{money(p.revenue)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="panel">
              <header className="panel-head">
                <div>
                  <h3>Stock attention</h3>
                  <p className="panel-sub">{stats.lowStock.length} low · {stats.outOfStock} out · {stats.expiring} expiring</p>
                </div>
                <button className="link-btn" onClick={() => onNavigate('inventory')}>Inventory <Icon name="arrowRight" size={13} /></button>
              </header>
              {stats.lowStock.length === 0 ? (
                <div className="empty-state compact">
                  <span className="empty-ico"><Icon name="check" size={20} /></span>
                  <p>Stock levels are healthy.</p>
                </div>
              ) : (
                <ul className="stock-list">
                  {stats.lowStock.map((p) => (
                    <li key={p.id}>
                      <span className="stock-name">{p.name}</span>
                      <span className="stock-bar">
                        <span style={{ width: `${Math.min(100, (p.stock / Math.max(p.lowStockAt, 1)) * 100)}%` }} />
                      </span>
                      <span className="stock-count">{p.stock} {p.unit}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mini-stats">
                <div><span>Inventory value</span><strong>{money(stats.inventoryValue)}</strong></div>
                <div><span>Retail value</span><strong>{money(stats.retailValue)}</strong></div>
              </div>
            </article>

            <article className="panel">
              <header className="panel-head">
                <div>
                  <h3>Recent transactions</h3>
                  <p className="panel-sub">Latest tickets in this range</p>
                </div>
                <button className="link-btn" onClick={() => onNavigate('sales')}>All sales <Icon name="arrowRight" size={13} /></button>
              </header>
              {stats.recentSales.length === 0 ? (
                <div className="empty-state compact"><p>No sales yet.</p></div>
              ) : (
                <ul className="tx-list">
                  {stats.recentSales.map((s) => (
                    <li key={s.id}>
                      <span className="tx-ico"><Icon name="receipt" size={15} /></span>
                      <span className="tx-main">
                        {s.customerName}
                        <small>{s.number} · {fmtDate(s.at)}</small>
                      </span>
                      <span className="tx-side">
                        <strong>{money(s.total)}</strong>
                        <small>{s.payment}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </section>

          {canManage && (
            <section className="finance-strip">
              <div className="finance-item">
                <span className="fi-label">Receivables</span>
                <strong>{money(stats.receivables)}</strong>
                <span className="fi-sub">Credit sales outstanding</span>
              </div>
              <div className="finance-item">
                <span className="fi-label">Payables</span>
                <strong>{money(stats.payables)}</strong>
                <span className="fi-sub">Owed to suppliers</span>
              </div>
              <div className="finance-item">
                <span className="fi-label">Purchases</span>
                <strong>{money(stats.purchasesTotal)}</strong>
                <span className="fi-sub">Goods received this period</span>
              </div>
              <div className="finance-item">
                <span className="fi-label">Expenses</span>
                <strong>{money(stats.expenses)}</strong>
                <span className="fi-sub">Operating costs this period</span>
              </div>
              <button className="finance-cta" onClick={() => onNavigate('accounting')}>
                <Icon name="chart" size={17} />
                <span>Open accounting</span>
                <Icon name="arrowRight" size={15} />
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
