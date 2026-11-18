import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Sale } from '../db';
import { voidSale } from '../actions';
import { config, formatMoney } from '../config';
import { listLocations } from '../location';
import { Receipt } from './Pos';
import { Icon } from '../components/Icon';
import { SalesDocuments } from './SalesDocuments';
import { Invoice } from '../components/Invoice';
import { requestApproval, APPROVAL_REQUIRED } from '../approvals';
import { downloadExcel } from '../export';

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 0, label: 'All' },
] as const;

function downloadCsv(rows: Sale[]): void {
  const header = ['Invoice', 'Date', 'Customer', 'Payment', 'Status', 'Items', 'Total'];
  const body = rows.map((s) => [
    s.number,
    new Date(s.at).toISOString(),
    s.customerName,
    s.payment,
    s.status,
    s.items.reduce((n, i) => n + i.qty, 0),
    s.total,
  ]);
  const csv = [header, ...body].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sales.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function Sales({ canManage, onNavigate }: { canManage: boolean; onNavigate: (tab: string) => void }) {
  const sales = useLiveQuery(() => db.sales.orderBy('at').reverse().limit(500).toArray(), [], []);
  const locations = useLiveQuery(() => listLocations(), [], []);
  const [view, setView] = useState<Sale | null>(null);
  const [invoice, setInvoice] = useState<Sale | null>(null);
  const [error, setError] = useState('');
  const [days, setDays] = useState(7);
  const [query, setQuery] = useState('');
  const [payment, setPayment] = useState('all');
  const [status, setStatus] = useState('all');
  const [branch, setBranch] = useState('all');
  const [mode, setMode] = useState<'invoices' | 'documents'>('invoices');

  const from = days === 0 ? 0 : (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() - (days - 1) * 86_400_000;
  })();

  const inRange = useMemo(
    () => sales.filter((s) => s.at >= from && (branch === 'all' || (s.locationId ?? 'main') === branch)),
    [sales, from, branch],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inRange.filter((s) => {
      if (payment !== 'all' && s.payment !== payment) return false;
      if (status !== 'all' && s.status !== status) return false;
      if (!q) return true;
      return `${s.number} ${s.customerName} ${s.payment} ${s.total}`.toLowerCase().includes(q);
    });
  }, [inRange, query, payment, status]);

  const completed = inRange.filter((s) => s.status === 'completed');
  const gross = completed.reduce((n, s) => n + s.total, 0);
  const refunds = useLiveQuery(
    async () => (await db.returns.toArray()).filter((r) => r.at >= from && r.status === 'completed' && (branch === 'all' || (r.locationId ?? 'main') === branch)).reduce((n, r) => n + r.totalRefunded, 0),
    [from, branch],
    0,
  );
  const avg = completed.length ? gross / completed.length : 0;
  const money = (n: number) => formatMoney(Math.round(n * 100) / 100);
  const fmt = (at: number) => new Date(at).toLocaleString(config.locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const voidOne = async (sale: Sale) => {
    if (!confirm(`Void ${sale.number}? Stock will be returned to this branch.`)) return;
    setError('');
    try {
      await voidSale(sale.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not void';
      if (message.startsWith(APPROVAL_REQUIRED)) {
        try {
          await requestApproval({ kind: 'void', entityId: sale.id, summary: `Void ${sale.number} — ${sale.customerName}`, amount: sale.total });
          setError('Approval requested. A manager can approve it in Advanced → Approvals, then try again.');
        } catch (err) {
          setError(err instanceof Error ? err.message : message);
        }
      } else {
        setError(message);
      }
    }
  };

  return (
    <div className="sales-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Sales ledger</span>
          <h1>Sales</h1>
          <p className="lede">Every ticket, payment and refund — recorded on this device and queued for sync.</p>
        </div>
        <div className="page-head-actions">
          <div className="segmented" role="group" aria-label="Range">
            {RANGES.map((r) => <button key={r.days} className={days === r.days ? 'active' : ''} onClick={() => setDays(r.days)}>{r.label}</button>)}
          </div>
          <button className="btn btn-secondary" onClick={() => downloadCsv(filtered)}><Icon name="download" size={15} /> CSV</button>
          <button className="btn btn-secondary" onClick={() => downloadExcel('sales', 'Sales', [['Invoice', 'Date', 'Customer', 'Payment', 'Status', 'Total'], ...filtered.map((s) => [s.number, new Date(s.at).toISOString(), s.customerName, s.payment, s.status, s.total])])}><Icon name="download" size={15} /> Excel</button>
          <button className="btn btn-primary" onClick={() => onNavigate('pos')}>
            <Icon name="pos" size={16} /> New sale
          </button>
        </div>
      </header>

      <div className="subtabs-bar">
        <button className={mode === 'invoices' ? 'subtab active' : 'subtab'} onClick={() => setMode('invoices')}><Icon name="receipt" size={15} /> Invoices</button>
        <button className={mode === 'documents' ? 'subtab active' : 'subtab'} onClick={() => setMode('documents')}><Icon name="clipboard" size={15} /> Quotations & orders</button>
      </div>

      {mode === 'documents' && <SalesDocuments />}

      {mode === 'invoices' && (
        <>
      <section className="summary-strip">
        <div><span className="fi-label">Gross sales</span><strong>{money(gross)}</strong><span className="fi-sub">{completed.length} paid tickets</span></div>
        <div><span className="fi-label">Refunds</span><strong>{money(refunds)}</strong><span className="fi-sub">Approved returns</span></div>
        <div><span className="fi-label">Net</span><strong>{money(gross - refunds)}</strong><span className="fi-sub">After refund book</span></div>
        <div><span className="fi-label">Average basket</span><strong>{money(avg)}</strong><span className="fi-sub">{inRange.length} transactions</span></div>
      </section>

      <div className="catalog-toolbar">
        <div className="pos-search compact-search">
          <Icon name="search" size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search invoice, customer or amount…" aria-label="Search sales" />
        </div>
        <div className="catalog-filters">
          <select value={payment} onChange={(e) => setPayment(e.target.value)} aria-label="Payment">
            <option value="all">All payments</option>
            <option value="cash">Cash</option>
            <option value="transfer">Transfer</option>
            <option value="card">Card</option>
            <option value="pos">POS</option>
            <option value="credit">Credit</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            <option value="completed">Completed</option>
            <option value="voided">Voided</option>
          </select>
          {locations.length > 1 && (
            <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
              <option value="all">All branches</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <span className="muted small">{filtered.length} shown</span>
        </div>
      </div>

      {error && <div className="alert-error" role="alert">{error}</div>}

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>When</th>
              <th>Customer</th>
              <th>Payment</th>
              <th className="num">Items</th>
              <th className="num">Total</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className={s.status === 'voided' ? 'row-voided' : ''}>
                <td className="fw-mono">{s.number}</td>
                <td className="muted">{fmt(s.at)}</td>
                <td>{s.customerName || 'Walk-in'}</td>
                <td><span className={`pay-badge pay-${s.payment}`}>{s.payment}</span></td>
                <td className="num">{s.items.reduce((n, i) => n + i.qty, 0)}</td>
                <td className="num fw-bold">{money(s.total)}</td>
                <td>{s.status === 'voided' ? <span className="badge badge-danger">Voided</span> : <span className="badge badge-success">Paid</span>}</td>
                <td className="num">
                  <div className="row-actions end">
                    <button className="btn btn-ghost btn-sm" onClick={() => setView(s)}>View</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setInvoice(s)}>Invoice</button>
                    {canManage && s.status === 'completed' && (
                      <button className="btn btn-ghost btn-sm danger-hover" onClick={() => void voidOne(s)}>Void</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={8} className="empty-table-cell">No sales match these filters.</td></tr>}
          </tbody>
        </table>
      </div>

      {view && <Receipt sale={view} onClose={() => setView(null)} />}
      {invoice && <Invoice sale={invoice} onClose={() => setInvoice(null)} />}
        </>
      )}
    </div>
  );
}
