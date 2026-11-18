import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type SaleDocument } from '../db';
import { formatMoney } from '../config';
import { createDocument, convertDocument, setDocumentStatus } from '../documents';
import { getSession } from '../auth';
import { Icon } from '../components/Icon';
import { currentLocationId } from '../location';

const money = (n: number): string => formatMoney(Math.round(n * 100) / 100);
const fmt = (at: number): string => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function SalesDocuments() {
  const docs = useLiveQuery(() => db.saleDocuments.orderBy('at').reverse().toArray(), [], []);
  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), [], []);
  const serials = useLiveQuery(() => db.serials.where('status').equals('in_stock').toArray(), [], []);
  const [converting, setConverting] = useState<SaleDocument | null>(null);
  const [convertSerials, setConvertSerials] = useState<Record<string, string[]>>({});
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<SaleDocument | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<'quote' | 'order'>('quote');
  const [customer, setCustomer] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<{ productId: string; qty: string; price: string }[]>([{ productId: '', qty: '1', price: '' }]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await createDocument({
        type,
        customerName: customer,
        items: items.filter((i) => i.productId && Number(i.qty) > 0).map((i) => ({ productId: i.productId, qty: Number(i.qty), ...(i.price !== '' ? { price: Number(i.price) } : {}) })),
        validUntil: validUntil ? new Date(`${validUntil}T23:59:59`).getTime() : undefined,
        note,
      });
      setOpen(false);
      setCustomer('');
      setNote('');
      setValidUntil('');
      setItems([{ productId: '', qty: '1', price: '' }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the document');
    } finally {
      setBusy(false);
    }
  };

  const convert = async (doc: SaleDocument, selections: Record<string, string[]> = {}) => {
    const tracked = doc.items.filter((it) => products.find((p) => p.id === it.productId)?.trackSerials);
    if (tracked.some((it) => (selections[it.productId]?.length ?? 0) !== it.qty)) {
      setConverting(doc);
      setConvertSerials(selections);
      return;
    }
    if (!confirm(`Convert ${doc.number} into a sale? Stock will be deducted now.`)) return;
    setError('');
    setBusy(true);
    try {
      const { sale } = await convertDocument(doc.id, 'cash', getSession()?.username, selections);
      setConverting(null);
      alert(`Sale ${sale.number} created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not convert the document');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sales-documents">
      <div className="catalog-toolbar">
        <div className="row-actions">
          <button className="btn btn-secondary" onClick={() => { setType('quote'); setOpen(true); }}><Icon name="receipt" size={15} /> New quotation</button>
          <button className="btn btn-secondary" onClick={() => { setType('order'); setOpen(true); }}><Icon name="clipboard" size={15} /> New sales order</button>
        </div>
        <span className="muted small">{docs.length} documents</span>
      </div>
      {error && <div className="alert-error">{error}</div>}
      <div className="table-container">
        <table className="data-table">
          <thead><tr><th>Number</th><th>Type</th><th>Customer</th><th>Date</th><th className="num">Total</th><th>Status</th><th /></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td className="fw-mono">{d.number}</td>
                <td><span className="badge badge-subtle">{d.type === 'quote' ? 'Quotation' : 'Sales order'}</span></td>
                <td>{d.customerName}</td>
                <td className="muted">{fmt(d.at)}</td>
                <td className="num fw-bold">{money(d.total)}</td>
                <td><span className={`badge ${d.status === 'converted' ? 'badge-success' : d.status === 'cancelled' ? 'badge-danger' : d.status === 'sent' ? 'badge-warning' : 'badge-subtle'}`}>{d.status}</span></td>
                <td className="num">
                  <div className="row-actions end">
                    <button className="btn btn-ghost btn-sm" onClick={() => setView(d)}>View</button>
                    {(d.status === 'draft' || d.status === 'sent' || d.status === 'accepted') && (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => void convert(d)}>Convert</button>
                        <button className="btn btn-ghost btn-sm danger-hover" onClick={async () => { if (confirm(`Cancel ${d.number}?`)) try { await setDocumentStatus(d.id, 'cancelled'); } catch (e) { setError(e instanceof Error ? e.message : 'Could not cancel'); } }}>Cancel</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {docs.length === 0 && <tr><td colSpan={7} className="empty-table-cell">No quotations or orders yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-dialog modal-large" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="New document">
            <form onSubmit={submit}>
              <header className="modal-header">
                <div><h3>{type === 'quote' ? 'New quotation' : 'New sales order'}</h3><p className="panel-sub">Stock moves only when converted to a sale.</p></div>
                <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><Icon name="close" size={16} /></button>
              </header>
              <div className="modal-body">
                {error && <div className="alert-error">{error}</div>}
                <div className="form-grid two-col">
                  <label className="field"><span>Customer</span><input value={customer} onChange={(e) => setCustomer(e.target.value)} required /></label>
                  <label className="field"><span>Valid until (quotation)</span><input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></label>
                </div>
                <div className="doc-lines">
                  {items.map((it, i) => (
                    <div className="doc-line" key={i}>
                      <select value={it.productId} onChange={(e) => {
                        const p = products.find((x) => x.id === e.target.value);
                        setItems(items.map((row, n) => n === i ? { ...row, productId: e.target.value, price: p ? String(p.price) : row.price } : row));
                      }} aria-label="Product">
                        <option value="">Choose product…</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <input type="number" min="0" step="any" value={it.qty} onChange={(e) => setItems(items.map((row, n) => n === i ? { ...row, qty: e.target.value } : row))} aria-label="Quantity" placeholder="Qty" />
                      <input type="number" min="0" step="any" value={it.price} onChange={(e) => setItems(items.map((row, n) => n === i ? { ...row, price: e.target.value } : row))} aria-label="Unit price" placeholder="Price" />
                      <button type="button" className="icon-btn" onClick={() => setItems(items.filter((_, n) => n !== i))} disabled={items.length <= 1} aria-label="Remove line"><Icon name="close" size={12} /></button>
                    </div>
                  ))}
                  <button type="button" className="link-btn" onClick={() => setItems([...items, { productId: '', qty: '1', price: '' }])}>+ Add line</button>
                </div>
                <label className="field"><span>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Terms, delivery instructions…" /></label>
              </div>
              <footer className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save document'}</button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {converting && (
        <div className="modal-backdrop" onClick={() => setConverting(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Choose serials for documents">
            <header className="modal-header">
              <div><h3>Choose serial numbers</h3><p className="panel-sub">{converting.number} · each serial-tracked unit needs a serial</p></div>
              <button className="icon-btn" onClick={() => setConverting(null)} aria-label="Close"><Icon name="close" size={16} /></button>
            </header>
            <div className="modal-body">
              {converting.items.filter((it) => products.find((p) => p.id === it.productId)?.trackSerials).map((it) => {
                const options = serials.filter((s) => s.productId === it.productId && s.locationId === currentLocationId());
                const chosen = convertSerials[it.productId] ?? [];
                return (
                  <div className="convert-serial-block" key={it.productId}>
                    <div className="convert-serial-head"><strong>{it.name}</strong><span className={chosen.length === it.qty ? 'text-success' : 'text-warning'}>{chosen.length} / {it.qty}</span></div>
                    <div className="serial-picker-list">
                      {options.length === 0 ? <p className="muted small">No available serials in this branch.</p> : options.map((s) => (
                        <label key={s.id}>
                          <input
                            type="checkbox"
                            checked={chosen.includes(s.id)}
                            onChange={(e) => {
                              const next = e.target.checked ? [...chosen, s.id] : chosen.filter((x) => x !== s.id);
                              setConvertSerials({ ...convertSerials, [it.productId]: next.slice(0, it.qty) });
                            }}
                          />
                          <span className="serial-main"><strong>{s.serial}</strong><small>{s.warrantyUntil ? `Warranty to ${new Date(s.warrantyUntil).toLocaleDateString()}` : 'No warranty'}</small></span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <footer className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setConverting(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={busy || converting.items.some((it) => products.find((p) => p.id === it.productId)?.trackSerials && (convertSerials[it.productId]?.length ?? 0) !== it.qty)}
                onClick={() => void convert(converting, convertSerials)}
              >
                {busy ? 'Converting…' : 'Convert to sale'}
              </button>
            </footer>
          </div>
        </div>
      )}

      {view && (
        <div className="modal-backdrop" onClick={() => setView(null)}>
          <div className="modal-dialog receipt-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="receipt-view">
              <div className="receipt">
                <div className="receipt-header">
                  <h3>{view.type === 'quote' ? 'QUOTATION' : 'SALES ORDER'}</h3>
                  <p className="receipt-meta">{view.number} · {fmt(view.at)}</p>
                  <p className="receipt-meta">Customer: {view.customerName}</p>
                  {view.validUntil && <p className="receipt-meta">Valid until {fmt(view.validUntil)}</p>}
                </div>
                <hr className="receipt-divider" />
                {view.items.map((it, i) => <div className="receipt-item-row" key={`${it.productId}-${i}`}><span>{it.qty} × {it.name}</span><span>{money(it.qty * it.price)}</span></div>)}
                <hr className="receipt-divider" />
                {view.discount > 0 && <div className="receipt-total-row"><span>Discount</span><span>−{money(view.discount)}</span></div>}
                {view.tax > 0 && <div className="receipt-total-row"><span>Tax</span><span>{money(view.tax)}</span></div>}
                <div className="receipt-total-row grand"><span>Total</span><span>{money(view.total)}</span></div>
                {view.note && <p className="small muted">{view.note}</p>}
              </div>
              <div className="receipt-footer-buttons no-print">
                <button className="btn btn-ghost" onClick={() => window.print()}><Icon name="printer" size={15} /> Print</button>
                <button className="btn btn-primary" onClick={() => setView(null)}>Done</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
