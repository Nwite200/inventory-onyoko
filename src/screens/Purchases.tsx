import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatMoney } from '../config';
import { addSupplier, payPurchase, receivePurchase, supplierBalances, voidPurchase } from '../purchases';
import { listLocations, currentLocationId } from '../location';
import { LineEditor, type Line } from './LineEditor';

export function Purchases() {
  const data = useLiveQuery(async () => {
    const [products, suppliers, purchases, balances, locs] = await Promise.all([
      db.products.orderBy('name').toArray(),
      db.suppliers.orderBy('name').toArray(),
      db.purchases.orderBy('at').reverse().limit(100).toArray(),
      supplierBalances(),
      listLocations(),
    ]);
    return { products, suppliers, purchases, balances, locs };
  }, []);
  const [supplier, setSupplier] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [paid, setPaid] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);

  if (!data) return <p className="muted">Loading…</p>;
  const { products, suppliers, purchases, balances, locs } = data;
  const shop = locs.find((l) => l.id === currentLocationId())?.name ?? 'this shop';
  const total = lines.reduce((s, l) => s + l.qty * (l.cost ?? 0), 0);
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
      });
      setLines([]); setPaid(''); setNote('');
    }, `Stock received into ${shop}.`);

  return (
    <div>
      <div className="two">
        <div className="card form">
          <h3>Receive goods into {shop}</h3>
          <input list="suppliers" placeholder="Supplier name" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          <datalist id="suppliers">{suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
          <LineEditor products={products} lines={lines} onChange={setLines} withCost />
          <div className="row total"><span>Total</span><span>{formatMoney(total)}</span></div>
          <label>Paid to supplier now<input type="number" min="0" step="any" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="0 = pay later" /></label>
          <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="primary" disabled={!supplier.trim() || lines.length === 0} onClick={() => void receive()}>Receive stock</button>
          {msg && <p className={ok ? 'muted' : 'error'} role="status">{msg}</p>}
        </div>

        <div className="card">
          <h3>Suppliers: what you owe</h3>
          {balances.length === 0 ? <p className="muted">No suppliers yet. They are created when you receive goods.</p> : balances.map((b) => (
            <div className="row" key={b.supplier.id}>
              <span>{b.supplier.name}<span className="small muted"> · bought {formatMoney(b.bought)}</span></span>
              <span className={b.owed > 0 ? 'warn-text' : 'muted'}>{b.owed > 0 ? `owe ${formatMoney(b.owed)}` : 'settled'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>No.</th><th>Date</th><th>Supplier</th><th>Shop</th><th>Items</th><th>Total</th><th>Owed</th><th /></tr></thead>
          <tbody>
            {purchases.map((p) => (
              <tr key={p.id} className={p.status === 'voided' ? 'voided' : ''}>
                <td>{p.number}</td>
                <td>{new Date(p.at).toLocaleDateString()}</td>
                <td>{p.supplierName}</td>
                <td>{where(p.locationId)}</td>
                <td className="small">{p.items.map((i) => `${i.name} × ${i.qty}`).join(', ')}</td>
                <td>{formatMoney(p.total)}</td>
                <td>{p.status === 'voided' ? 'cancelled' : p.total - p.paid > 0 ? formatMoney(p.total - p.paid) : '—'}</td>
                <td className="adjust">
                  {p.status === 'received' && p.total - p.paid > 0 && (
                    <button onClick={() => {
                      const a = window.prompt(`Payment to ${p.supplierName} (owed ${p.total - p.paid})`, String(p.total - p.paid));
                      if (a) void run(() => payPurchase(p.id, Number(a)), 'Payment recorded.');
                    }}>Pay</button>
                  )}
                  {p.status === 'received' && (
                    <button className="danger" onClick={() => {
                      if (window.confirm('Cancel this purchase? The goods are taken out of stock again.')) void run(() => voidPurchase(p.id), 'Purchase cancelled.');
                    }}>Cancel</button>
                  )}
                </td>
              </tr>
            ))}
            {purchases.length === 0 && <tr><td colSpan={8} className="muted">No purchases yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
