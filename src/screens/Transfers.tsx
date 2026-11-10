import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { currentLocationId, listLocations } from '../location';
import { receiveTransfer, sendTransfer } from '../transfers';
import { LineEditor, type Line } from './LineEditor';

export function Transfers() {
  const data = useLiveQuery(async () => {
    const [products, transfers, locs] = await Promise.all([
      db.products.orderBy('name').toArray(),
      db.transfers.orderBy('sentAt').reverse().limit(100).toArray(),
      listLocations(),
    ]);
    return { products, transfers, locs };
  }, []);
  const [to, setTo] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);

  if (!data) return <p className="muted">Loading…</p>;
  const { products, transfers, locs } = data;
  const here = currentLocationId();
  const name = (id: string) => locs.find((l) => l.id === id)?.name ?? id;
  const others = locs.filter((l) => l.id !== here);
  const incoming = transfers.filter((t) => t.status === 'sent' && t.toLocationId === here);

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

  if (others.length === 0) {
    return <p className="muted">There is only one shop. The owner can add another in Settings &gt; Shops, then goods can be moved between them here.</p>;
  }

  return (
    <div>
      {incoming.length > 0 && (
        <div className="card">
          <h3>Arriving at {name(here)}</h3>
          {incoming.map((t) => (
            <div className="row" key={t.id}>
              <span>{t.number} from {name(t.fromLocationId)}: {t.items.map((i) => `${i.name} × ${i.qty}`).join(', ')}</span>
              <button className="primary" onClick={() => void run(() => receiveTransfer(t.id), 'Received. Stock added to this shop.')}>Goods arrived</button>
            </div>
          ))}
        </div>
      )}
      <div className="card form">
        <h3>Send goods from {name(here)}</h3>
        <select aria-label="Send to" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Send to which shop?</option>
          {others.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <LineEditor products={products} lines={lines} onChange={setLines} />
        <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="primary" disabled={!to || lines.length === 0} onClick={() => void run(async () => {
          await sendTransfer({ toLocationId: to, items: lines.map((l) => ({ productId: l.productId, qty: l.qty })), note });
          setLines([]); setNote('');
        }, 'Sent. It comes out of this shop now and goes into the other shop when they confirm.')}>Send</button>
        {msg && <p className={ok ? 'muted' : 'error'} role="status">{msg}</p>}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>No.</th><th>Date</th><th>From → To</th><th>Items</th><th>Status</th></tr></thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id}>
                <td>{t.number}</td>
                <td>{new Date(t.sentAt).toLocaleDateString()}</td>
                <td>{name(t.fromLocationId)} → {name(t.toLocationId)}</td>
                <td className="small">{t.items.map((i) => `${i.name} × ${i.qty}`).join(', ')}</td>
                <td><span className={`pill ${t.status === 'received' ? 'ok' : 'warn'}`}>{t.status === 'received' ? 'received' : 'on the way'}</span></td>
              </tr>
            ))}
            {transfers.length === 0 && <tr><td colSpan={5} className="muted">No transfers yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
