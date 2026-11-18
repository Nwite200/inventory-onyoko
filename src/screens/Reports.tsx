import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Sale } from '../db';
import { config, formatMoney } from '../config';
import { listLocations } from '../location';
import { DAY, RANGES, loadDashboard, salesInRange, startOfDay, type Snapshot } from '../analytics';
import { expiryReport } from '../lots';
import { serverMode } from '../auth';
import { Icon } from '../components/Icon';
import { AreaChart, Donut, Meter } from '../components/charts';
import { downloadExcel, printPdf } from '../export';

const PAY_COLORS: Record<string, string> = { cash: '#4f46e5', transfer: '#0ea5e9', card: '#10b981', pos: '#8b5cf6', credit: '#f59e0b', split: '#64748b' };
const money = (n: number) => formatMoney(Math.round(n * 100) / 100);
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}m` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(Math.round(n)));

export function Reports({ canManage }: { canManage: boolean }) {
  const [days, setDays] = useState(30);
  const [branch, setBranch] = useState('all');
  const locations = useLiveQuery(() => listLocations(), [], []);
  const pendingDb = useLiveQuery(() => db.outbox.count(), [], 0);
  const pending = serverMode() ? pendingDb : 0;
  const snapshot = useLiveQuery<Snapshot>(() => loadDashboard(days, branch === 'all' ? null : branch), [days, branch]);

  const range = useMemo(() => {
    const to = startOfDay() + DAY;
    return { from: to - days * DAY, to };
  }, [days]);

  const categoryStats = useLiveQuery(async () => {
    const [products, sales] = await Promise.all([db.products.toArray(), db.sales.toArray()]);
    const byId = new Map(products.map((p) => [p.id, p]));
    const totals = new Map<string, { revenue: number; qty: number }>();
    for (const sale of salesInRange(sales, range.from, range.to, branch === 'all' ? null : branch)) {
      for (const item of sale.items) {
        const category = byId.get(item.productId)?.category || 'Uncategorised';
        const row = totals.get(category) ?? { revenue: 0, qty: 0 };
        row.revenue += item.qty * item.price;
        row.qty += item.qty;
        totals.set(category, row);
      }
    }
    return [...totals.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue);
  }, [range, branch], []);

  const branchRows = useLiveQuery(async () => {
    const [sales, locs] = await Promise.all([db.sales.toArray(), listLocations()]);
    const flash = salesInRange(sales, range.from, range.to, null);
    return locs
      .map((l) => {
        const mine = flash.filter((s) => (s.locationId ?? 'main') === l.id);
        return { id: l.id, name: l.name, revenue: mine.reduce((n, s) => n + s.total, 0), count: mine.length };
      })
      .filter((r) => r.count > 0)
      .sort((a, b) => b.revenue - a.revenue);
  }, [range], []);

  const expiring = useLiveQuery(() => expiryReport(30), [], []);
  const payTotal = snapshot?.paymentMix.reduce((n, p) => n + p.total, 0) ?? 0;
  const categoryTotal = (categoryStats ?? []).reduce((n, c) => n + c.revenue, 0);
  const categoryColors = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#e11d48', '#64748b'];

  const exportExcel = async () => {
    const sales = await db.sales.toArray();
    const rows = salesInRange(sales, range.from, range.to, branch === 'all' ? null : branch).sort((a, b) => b.at - a.at);
    downloadExcel('sales-report', 'Sales report', [['Invoice', 'Date', 'Customer', 'Payment', 'Items', 'Total'], ...rows.map((s: Sale) => [s.number, new Date(s.at).toISOString(), s.customerName, s.payment, s.items.reduce((n, i) => n + i.qty, 0), s.total])]);
  };

  const exportCsv = async () => {
    const sales = await db.sales.toArray();
    const rows = salesInRange(sales, range.from, range.to, branch === 'all' ? null : branch).sort((a, b) => b.at - a.at);
    const header = ['Invoice', 'Date', 'Customer', 'Payment', 'Items', 'Total'];
    const body: (string | number)[][] = rows.map((s: Sale) => [s.number, new Date(s.at).toISOString(), s.customerName, s.payment, s.items.reduce((n, i) => n + i.qty, 0), s.total]);
    const csv = [header, ...body].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-report-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="reports-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Insights</span>
          <h1>Reports & analytics</h1>
          <p className="lede">
            {days === 1 ? 'Today' : `Last ${days} days`} · {branch === 'all' ? 'all branches' : locations.find((l) => l.id === branch)?.name}.
            {pending > 0 && <> <span className="inline-warn">{pending} local change{pending === 1 ? '' : 's'} awaiting sync — figures include them.</span></>}
          </p>
        </div>
        <div className="page-head-actions">
          {locations.length > 1 && (
            <label className="select-wrap">
              <Icon name="store" size={15} />
              <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
                <option value="all">All branches</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          )}
          <div className="segmented" role="group" aria-label="Range">
            {RANGES.map((r) => <button key={r.days} className={days === r.days ? 'active' : ''} onClick={() => setDays(r.days)}>{r.label}</button>)}
          </div>
          <button className="btn btn-secondary" onClick={() => void exportCsv()}><Icon name="download" size={15} /> CSV</button>
          <button className="btn btn-secondary" onClick={() => void exportExcel()}><Icon name="download" size={15} /> Excel</button>
          <button className="btn btn-secondary" onClick={() => printPdf()}><Icon name="printer" size={15} /> PDF</button>
        </div>
      </header>

      {!snapshot ? (
        <div className="skeleton-grid">{Array.from({ length: 4 }, (_, i) => <div className="skeleton-card" key={i} />)}</div>
      ) : (
        <>
          <section className={`summary-strip ${canManage ? 'six' : 'three'}`}>
            <div><span className="fi-label">Gross sales</span><strong>{money(snapshot.revenue)}</strong><span className="fi-sub">{snapshot.salesCount} transactions</span></div>
            {canManage && <div><span className="fi-label">Gross profit</span><strong>{money(snapshot.grossProfit)}</strong><span className="fi-sub">COGS {money(snapshot.cogs)}</span></div>}
            {canManage && <div><span className="fi-label">Net profit</span><strong className={snapshot.netProfit < 0 ? 'text-danger' : ''}>{money(snapshot.netProfit)}</strong><span className="fi-sub">Expenses {money(snapshot.expenses)}</span></div>}
            <div><span className="fi-label">Refunds</span><strong>{money(snapshot.returnsTotal)}</strong><span className="fi-sub">Refund book</span></div>
            <div><span className="fi-label">Inventory</span><strong>{money(snapshot.inventoryValue)}</strong><span className="fi-sub">At cost</span></div>
            {canManage && <div><span className="fi-label">Receivables</span><strong>{money(snapshot.receivables)}</strong><span className="fi-sub">Credit sales</span></div>}
          </section>

          <section className="dashboard-main">
            <article className="panel">
              <header className="panel-head">
                <div><h3>Sales trend</h3><p className="panel-sub">Daily sales, {days === 1 ? 'by hour' : 'by day'}</p></div>
                <span className="legend-dot" style={{ background: 'var(--primary)' }} />
              </header>
              {snapshot.revenue === 0 ? <div className="empty-state compact"><p>No sales in this period.</p></div> : <AreaChart points={snapshot.series} formatValue={compact} />}
              <footer className="panel-foot">
                <span>{snapshot.salesCount} tickets · avg {money(snapshot.salesCount ? snapshot.revenue / snapshot.salesCount : 0)}</span>
                <span className="muted">{money(snapshot.todayRevenue)} today</span>
              </footer>
            </article>

            <article className="panel">
              <header className="panel-head"><div><h3>Payment methods</h3><p className="panel-sub">Share of collected value</p></div></header>
              {payTotal === 0 ? <div className="empty-state compact"><p>No payments yet.</p></div> : (
                <div className="donut-block">
                  <Donut size={150} slices={snapshot.paymentMix.map((p) => ({ label: p.method, value: p.total, color: PAY_COLORS[p.method] ?? '#64748b' }))} centerValue={money(payTotal)} centerLabel="collected" />
                  <ul className="legend-list">
                    {snapshot.paymentMix.map((p) => (
                      <li key={p.method}>
                        <span className="legend-dot" style={{ background: PAY_COLORS[p.method] ?? '#64748b' }} />
                        <span className="legend-name">{p.method}</span>
                        <span className="legend-value">{Math.round((p.total / payTotal) * 100)}%</span>
                        <span className="legend-amount">{money(p.total)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          </section>

          <section className="dashboard-three">
            <article className="panel">
              <header className="panel-head"><div><h3>Product performance</h3><p className="panel-sub">Top sellers by revenue</p></div></header>
              {snapshot.topProducts.length === 0 ? <div className="empty-state compact"><p>No sales yet.</p></div> : (
                <div className="table-scroll">
                  <table className="data-table compact-table">
                    <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Revenue</th></tr></thead>
                    <tbody>
                      {snapshot.topProducts.map((p) => (
                        <tr key={p.id}><td>{p.name}</td><td className="num">{p.qty}</td><td className="num">{money(p.revenue)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>

            <article className="panel">
              <header className="panel-head"><div><h3>Sales by category</h3><p className="panel-sub">Where revenue comes from</p></div></header>
              {categoryTotal === 0 ? <div className="empty-state compact"><p>No category sales yet.</p></div> : (
                <div className="category-list">
                  {categoryStats.slice(0, 6).map((c, i) => (
                    <div key={c.name} className="category-row">
                      <span className="legend-dot" style={{ background: categoryColors[i % categoryColors.length] }} />
                      <span className="category-name">{c.name}</span>
                      <Meter value={c.revenue} max={categoryStats[0]!.revenue} tone={i === 0 ? 'emerald' : 'primary'} />
                      <span className="category-value">{Math.round((c.revenue / categoryTotal) * 100)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="panel">
              <header className="panel-head"><div><h3>Stock & expiry</h3><p className="panel-sub">{snapshot.lowStock.length} low · {snapshot.outOfStock} out · {snapshot.expiring} expiring</p></div></header>
              {snapshot.lowStock.length === 0 && expiring.length === 0 ? (
                <div className="empty-state compact"><span className="empty-ico"><Icon name="check" size={18} /></span><p>Stock levels are healthy.</p></div>
              ) : (
                <ul className="stock-list report-stock">
                  {snapshot.lowStock.map((p) => (
                    <li key={p.id}><span className="stock-name">{p.name}</span><span className="stock-bar"><span style={{ width: `${Math.min(100, (p.stock / Math.max(p.lowStockAt, 1)) * 100)}%` }} /></span><span className="stock-count">{p.stock} {p.unit}</span></li>
                  ))}
                  {expiring.slice(0, 3).map((e) => (
                    <li key={e.lotId}><span className="stock-name">{e.name}{e.batchNo ? ` (${e.batchNo})` : ''}</span><span className="muted small">{new Date(e.expiresAt).toLocaleDateString()}</span><span className={`stock-count ${e.expired ? 'text-danger' : ''}`}>{e.expired ? 'Expired' : `${e.remaining} left`}</span></li>
                  ))}
                </ul>
              )}
            </article>
          </section>

          {locations.length > 1 && branchRows.length > 0 && (
            <section className="panel">
              <header className="panel-head"><div><h3>Branch comparison</h3><p className="panel-sub">Sales for the selected period</p></div></header>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Branch</th><th className="num">Transactions</th><th className="num">Sales</th><th className="num">Average basket</th><th className="num">Share</th></tr></thead>
                  <tbody>
                    {branchRows.map((r) => (
                      <tr key={r.id}>
                        <td><strong>{r.name}</strong></td>
                        <td className="num">{r.count}</td>
                        <td className="num">{money(r.revenue)}</td>
                        <td className="num">{money(r.count ? r.revenue / r.count : 0)}</td>
                        <td className="num">{Math.round((r.revenue / Math.max(1, branchRows.reduce((n, x) => n + x.revenue, 0))) * 100)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <p className="report-note">
            <Icon name="alert" size={14} /> {canManage ? 'Cost of goods uses the cost captured at each sale. ' : ''}Figures include local changes not yet synchronized
            {pending > 0 ? ` (${pending} waiting)` : ' (none waiting)'}. {config.serverUrl ? 'Synchronized with the shop server.' : 'Running on this device only.'}
          </p>
        </>
      )}
    </div>
  );
}
