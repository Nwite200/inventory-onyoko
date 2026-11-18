import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { config, formatMoney } from '../config';
import { addSupplier, payPurchase, receivePurchase, supplierBalances, voidPurchase } from '../purchases';
import { listLocations, currentLocationId } from '../location';
import { LineEditor, type Line } from './LineEditor';
import { Icon } from '../components/Icon';

export function Purchases() {
  const data = useLiveQuery(async () => {
    const [products, suppliers, purchases, balances, locs] = await Promise.all([
      db.products.orderBy('name').toArray(),
      db.suppliers.orderBy('name').toArray(),
      db.purchases.orderBy('at').reverse().limit(100).toArray(),
      supplierBalances(),
      listLocations(),
    ]);
    const currencies = await db.currencies.toArray();
    return { products, suppliers, purchases, balances, locs, currencies };
  }, []);
  const [supplier, setSupplier] = useState('');
  const [currency, setCurrency] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [paid, setPaid] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);
  const [paying, setPaying] = useState<{ id: string; name: string; owed: number; amount: string } | null>(null);

  if (!data) return <p className="muted">Loading…</p>;
  const { products, suppliers, purchases, balances, locs, currencies } = data;
  const shop = locs.find((l) => l.id === currentLocationId())?.name ?? 'this shop';
  const selectedCurrency = currencies.find((c) => c.code === currency);
  const enteredTotal = lines.reduce((s, l) => s + l.qty * (l.cost ?? 0), 0);
  const total = selectedCurrency ? enteredTotal * selectedCurrency.rate : enteredTotal;
  const where = (id: string) => locs.find((l) => l.id === id)?.name ?? id;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setMsg('');
    try {
      await fn();
      setOk(true);
      setMsg(done);
    } catch (e) {
      setOk(false);
      setMsg(e instanceof Error ? e.message : 'Something went wrong');
    }
  };

  const receive = () =>
    run(async () => {
      const existing = suppliers.find((s) => s.name.toLowerCase() === supplier.trim().toLowerCase());
      const s = existing ?? (await addSupplier(supplier));
      await receivePurchase({
        supplierId: s.id,
        items: lines.map((l) => ({ productId: l.productId, qty: l.qty, cost: l.cost ?? 0, batchNo: l.batchNo, expiresAt: l.expiresAt })),
        paid: Number(paid) || 0,
        note,
        ...(selectedCurrency ? { currency: selectedCurrency.code, fxRate: selectedCurrency.rate } : {}),
      });
      setLines([]); setPaid(''); setNote(''); setCurrency('');
    }, `Stock received into ${shop}.`);

  return (
    <div>
      <header className="page-head">
        <div>
          <span className="eyebrow">Procurement</span>
          <h1>Purchases</h1>
          <p className="lede">Receive goods into {shop}, track supplier balances and settle what you owe.</p>
        </div>
        <div className="page-head-actions">
          <span className="badge badge-subtle"><Icon name="truck" size={13} /> {purchases.filter((p) => p.status === 'received').length} receipts</span>
        </div>
      </header>

      <section className="summary-strip">
        <div><span className="fi-label">Payables</span><strong>{formatMoney(balances.reduce((s, b) => s + b.owed, 0))}</strong><span className="fi-sub">Owed to suppliers</span></div>
        <div><span className="fi-label">Purchases</span><strong>{formatMoney(purchases.filter((p) => p.status === 'received').reduce((s, p) => s + p.total, 0))}</strong><span className="fi-sub">Last 100 receipts</span></div>
        <div><span className="fi-label">Suppliers</span><strong>{suppliers.length}</strong><span className="fi-sub">{balances.filter((b) => b.owed > 0).length} with a balance</span></div>
        <div><span className="fi-label">Branch</span><strong className="summary-text">{shop}</strong><span className="fi-sub">Goods are received here</span></div>
      </section>

      <div className="two">
        <div className="card form">
          <h3>Receive goods into {shop}</h3>
          <input list="suppliers" placeholder="Supplier name" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          <datalist id="suppliers">{suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
          {currencies.length > 0 && (
            <label className="field"><span>Purchase currency</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="">{config.currencySymbol} base currency</option>
                {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} @ {c.rate}</option>)}
              </select>
            </label>
          )}
          <LineEditor products={products} lines={lines} onChange={setLines} withCost costLabel={selectedCurrency ? `${selectedCurrency.code} unit cost` : undefined} />
          <div className="row total"><span>Total{selectedCurrency ? ` (base; ${selectedCurrency.code} ${enteredTotal.toFixed(2)})` : ''}</span><span>{formatMoney(total)}</span></div>
          <label>Paid to supplier now ({config.currencySymbol} base)<input type="number" min="0" step="any" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="0 = pay later" /></label>
          <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="primary" disabled={!supplier.trim() || lines.length === 0} onClick={() => void receive()}>Receive stock</button>
          {msg && <p className={ok ? 'muted' : 'error'} role="status">{msg}</p>}
        </div>

        <div className="card">
          <h3>Supplier balances</h3>
          {balances.length === 0 ? <p className="muted">No suppliers yet. They are created when you receive goods.</p> : balances.map((b) => (
            <div className="row" key={b.supplier.id}>
              <span>{b.supplier.name}<span className="small muted"> · bought {formatMoney(b.bought)}</span></span>
              <span className={b.owed > 0 ? 'warn-text' : 'muted'}>{b.owed > 0 ? `owe ${formatMoney(b.owed)}` : 'settled'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead><tr><th>Receipt</th><th>Date</th><th>Supplier</th><th>Branch</th><th>Items</th><th className="num">Total</th><th className="num">Owed</th><th /></tr></thead>
          <tbody>
            {purchases.map((p) => (
              <tr key={p.id} className={p.status === 'voided' ? 'row-voided' : ''}>
                <td className="fw-mono">{p.number}</td>
                <td className="muted">{new Date(p.at).toLocaleDateString()}</td>
                <td>{p.supplierName}</td>
                <td>{where(p.locationId)}</td>
                <td className="small">{p.items.map((i) => `${i.name} × ${i.qty}`).join(', ')}</td>
                <td className="num fw-bold">{formatMoney(p.total)}{p.currency && p.foreignTotal !== undefined && <div className="muted small">{p.currency} {p.foreignTotal.toLocaleString(config.locale, { maximumFractionDigits: 2 })}</div>}</td>
                <td className="num">{p.status === 'voided' ? <span className="badge badge-danger">Cancelled</span> : p.total - p.paid > 0 ? <span className="text-amber">{formatMoney(p.total - p.paid)}</span> : <span className="badge badge-success">Settled</span>}</td>
                <td className="num">
                  <div className="row-actions end">
                    {p.status === 'received' && p.total - p.paid > 0 && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setPaying({ id: p.id, name: p.supplierName, owed: p.total - p.paid, amount: String(p.total - p.paid) })}>Pay</button>
                    )}
                    {p.status === 'received' && (
                      <button className="btn btn-ghost btn-sm danger-hover" onClick={() => {
                        if (window.confirm('Cancel this purchase? The goods are taken out of stock again.')) void run(() => voidPurchase(p.id), 'Purchase cancelled.');
                      }}>Cancel</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {purchases.length === 0 && <tr><td colSpan={8} className="empty-table-cell">No purchases yet. Receive your first delivery above.</td></tr>}
          </tbody>
        </table>
      </div>

      {paying && (
        <div className="modal-backdrop" onClick={() => setPaying(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Pay supplier">
            <header className="modal-header">
              <div><h3>Pay supplier</h3><p className="panel-sub">{paying.name} · {formatMoney(paying.owed)} owed</p></div>
              <button className="icon-btn" onClick={() => setPaying(null)} aria-label="Close"><Icon name="close" size={16} /></button>
            </header>
            <div className="modal-body">
              <label className="field"><span>Amount ({config.currencySymbol})</span>
                <input type="number" min="0" step="any" value={paying.amount} onChange={(e) => setPaying({ ...paying, amount: e.target.value })} autoFocus />
              </label>
              <p className="panel-sub">This is recorded as a cash payment and posted to accounts payable.</p>
            </div>
            <footer className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setPaying(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => {
                const amount = Number(paying.amount);
                if (!(amount > 0)) return;
                void run(() => payPurchase(paying.id, amount), 'Payment recorded.').then(() => setPaying(null));
              }}>Record payment</button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
