import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type SaleReturn, type Sale } from '../db';
import { config } from '../config';
import { refundSale } from '../returns';
import { Icon } from '../components/Icon';
import { requestApproval, APPROVAL_REQUIRED } from '../approvals';

export function Returns() {
  const [showModal, setShowModal] = useState(false);
  const [saleSearch, setSaleSearch] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [returnItems, setReturnItems] = useState<{ [productId: string]: { qty: number; condition: 'restock' | 'damaged'; serials?: string[] } }>({});
  const [refundMethod, setRefundMethod] = useState('cash');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [activeReceipt, setActiveReceipt] = useState<SaleReturn | null>(null);
  const [busy, setBusy] = useState(false);

  const returns = useLiveQuery(() => db.returns.orderBy('at').reverse().toArray(), [], []);
  const priorReturns = useLiveQuery(
    async () => (selectedSale ? db.returns.where('saleId').equals(selectedSale.id).toArray() : []),
    [selectedSale?.id],
    [],
  );
  const soldSerials = useLiveQuery(
    async () => (selectedSale ? (await db.serials.toArray()).filter((s) => s.saleId === selectedSale.id && s.status === 'sold') : []),
    [selectedSale?.id],
    [],
  );

  const returnedQty = (productId: string): number =>
    (priorReturns ?? [])
      .filter((r) => r.status === 'completed')
      .reduce((sum, r) => sum + r.items.filter((i) => i.productId === productId).reduce((n, i) => n + i.qty, 0), 0);

  const remainingQty = (item: { productId: string; qty: number }): number =>
    Math.max(0, item.qty - returnedQty(item.productId));

  const handleSearchSale = async () => {
    setError('');
    const query = saleSearch.trim();
    if (!query) return;

    // Search by receipt / sale number or ID
    const found = await db.sales.where('number').equals(query).first();
    if (!found) {
      const byId = await db.sales.get(query);
      if (!byId) {
        setError(`Sale "${query}" not found. Verify the receipt reference number.`);
        setSelectedSale(null);
        return;
      }
      setSelectedSale(byId);
    } else {
      setSelectedSale(found);
    }
    if ((found ?? (await db.sales.get(query)))?.status === 'voided') {
      setError('That sale was voided. A void already returns the stock — do not refund it again.');
      setSelectedSale(null);
      return;
    }

    // Initialize return quantities
    setReturnItems({});
  };

  const handleQtyChange = (productId: string, qty: number, maxQty: number) => {
    const validQty = Math.max(0, Math.min(qty, maxQty));
    setReturnItems((prev) => ({
      ...prev,
      [productId]: {
        qty: validQty,
        condition: prev[productId]?.condition || 'restock',
      },
    }));
  };

  const handleConditionChange = (productId: string, condition: 'restock' | 'damaged') => {
    setReturnItems((prev) => ({
      ...prev,
      [productId]: {
        qty: prev[productId]?.qty || 0,
        condition,
        ...(prev[productId]?.serials ? { serials: prev[productId]!.serials } : {}),
      },
    }));
  };

  const toggleReturnSerial = (productId: string, serialId: string) => {
    setReturnItems((prev) => {
      const cur = prev[productId] ?? { qty: 0, condition: 'restock' as const };
      const list = cur.serials ?? [];
      const serials = list.includes(serialId) ? list.filter((x) => x !== serialId) : [...list, serialId];
      return { ...prev, [productId]: { ...cur, serials, qty: serials.length } };
    });
  };

  const calculateTotalRefund = () => {
    if (!selectedSale) return 0;
    return selectedSale.items.reduce((sum, item) => {
      const ret = returnItems[item.productId];
      const qty = ret?.qty || 0;
      return sum + qty * item.price;
    }, 0);
  };

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSale || busy) return;

    const requested = selectedSale.items
      .map((item) => {
        const ret = returnItems[item.productId];
        const serials = ret?.serials ?? [];
        return {
          productId: item.productId,
          qty: serials.length > 0 ? serials.length : ret?.qty ?? 0,
          condition: ret?.condition ?? ('restock' as const),
          ...(serials.length > 0 ? { serials } : {}),
        };
      })
      .filter((i) => i.qty > 0);

    if (requested.length === 0) {
      setError('Please select at least one item and quantity to refund.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const returnRecord = await refundSale({
        saleId: selectedSale.id,
        items: requested,
        paymentMethod: refundMethod,
        reason,
      });

      // Reset state & show receipt
      setShowModal(false);
      setSelectedSale(null);
      setReturnItems({});
      setReason('');
      setActiveReceipt(returnRecord);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save the refund';
      if (message.startsWith(APPROVAL_REQUIRED)) {
        try {
          await requestApproval({ kind: 'refund', entityId: selectedSale.id, summary: `Refund ${selectedSale.number} — ${selectedSale.customerName}`, amount: requested.reduce((s, i) => s + i.qty * (selectedSale.items.find((x) => x.productId === i.productId)?.price ?? 0), 0) });
          setError('Approval requested. A manager can approve it in Advanced → Approvals, then try the refund again.');
        } catch (e) {
          setError(e instanceof Error ? e.message : message);
        }
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const money = (val: number) =>
    `${config.currencySymbol}${Number(val).toLocaleString(config.locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  const fmtDate = (at: number) =>
    new Date(at).toLocaleDateString(config.locale, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="returns-module">
      <div className="module-header">
        <div>
          <span className="eyebrow">After-sales</span>
          <h2>Refund book</h2>
          <p className="muted">Process returns, restock eligible goods and keep every refund traceable.</p>
        </div>
        <button className="primary-btn" onClick={() => setShowModal(true)}>
          <Icon name="refund" size={15} /> Process refund
        </button>
      </div>

      {/* Returns History Table */}
      <div className="table-container">
        <table className="modern-table">
          <thead>
            <tr>
              <th>Return #</th>
              <th>Original Sale</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Items Refunded</th>
              <th>Method</th>
              <th style={{ textAlign: 'right' }}>Total Refunded</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {(!returns || returns.length === 0) ? (
              <tr>
                <td colSpan={8} className="empty-table-cell">
                  No return records found. All sales intact.
                </td>
              </tr>
            ) : (
              returns.map((ret) => (
                <tr key={ret.id}>
                  <td className="fw-mono fw-bold">{ret.number}</td>
                  <td className="fw-mono text-primary">{ret.saleNumber}</td>
                  <td className="muted small">{fmtDate(ret.at)}</td>
                  <td>{ret.customerName || 'Walk-in'}</td>
                  <td>
                    {ret.items.map((it) => (
                      <div key={it.productId} className="small">
                        {it.qty}x {it.name}{' '}
                        <span className={`badge ${it.condition === 'restock' ? 'badge-success' : 'badge-danger'}`}>
                          {it.condition}
                        </span>
                      </div>
                    ))}
                  </td>
                  <td>
                    <span className="badge badge-subtle">{ret.paymentMethod}</span>
                  </td>
                  <td className="fw-bold text-danger" style={{ textAlign: 'right' }}>
                    {money(ret.totalRefunded)}
                  </td>
                  <td>
                    <button className="small-btn" onClick={() => setActiveReceipt(ret)}>
                      Receipt
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* New Return Modal */}
      {showModal && (
        <div className="modal-backdrop">
          <div className="modal-dialog modal-large">
            <div className="modal-header">
              <h3>Process Sales Return</h3>
              <button className="close-btn" onClick={() => setShowModal(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              {error && <div className="alert-error">{error}</div>}

              {/* Step 1: Look up sale */}
              <div className="lookup-bar">
                <input
                  type="text"
                  placeholder="Enter original Sale Number (e.g. 0001, SALE-1002)..."
                  value={saleSearch}
                  onChange={(e) => setSaleSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearchSale()}
                />
                <button type="button" className="btn-secondary" onClick={handleSearchSale}>
                  Find Sale
                </button>
              </div>

              {selectedSale && (
                <form onSubmit={handleSubmitReturn} style={{ marginTop: '1rem' }}>
                  <div className="sale-summary-card">
                    <div className="row">
                      <span>Original Sale: <strong>{selectedSale.number}</strong></span>
                      <span>Customer: <strong>{selectedSale.customerName || 'Walk-in'}</strong></span>
                      <span>Total Paid: <strong>{money(selectedSale.total)}</strong></span>
                      <span>Date: <strong>{fmtDate(selectedSale.at)}</strong></span>
                    </div>
                  </div>

                  <h4 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>Select Items to Return</h4>
                  <table className="mini-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Sold Qty</th>
                        <th>Unit Price</th>
                        <th>Return Qty</th>
                        <th>Condition</th>
                        <th>Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSale.items.map((item) => {
                        const cur = returnItems[item.productId] || { qty: 0, condition: 'restock' };
                        const remaining = remainingQty(item);
                        const serialsFor = soldSerials.filter((s) => s.productId === item.productId);
                        const tracked = Boolean(item.serials?.length);
                        return (
                          <tr key={item.productId}>
                            <td>{item.name}</td>
                            <td>
                              {item.qty}
                              {returnedQty(item.productId) > 0 && (
                                <div className="muted small">{returnedQty(item.productId)} already refunded</div>
                              )}
                            </td>
                            <td>{money(item.price)}</td>
                            <td>
                              {tracked ? (
                                serialsFor.length === 0 ? <span className="muted small">All returned</span> : (
                                  <div className="serial-return-list">
                                    {serialsFor.map((s) => (
                                      <label key={s.id}>
                                        <input
                                          type="checkbox"
                                          checked={(cur.serials ?? []).includes(s.id)}
                                          onChange={() => toggleReturnSerial(item.productId, s.id)}
                                        />
                                        <span className="fw-mono small">{s.serial}</span>
                                      </label>
                                    ))}
                                  </div>
                                )
                              ) : (
                                <input
                                  type="number"
                                  min="0"
                                  max={remaining}
                                  value={cur.qty}
                                  onChange={(e) =>
                                    handleQtyChange(item.productId, parseInt(e.target.value) || 0, remaining)
                                  }
                                  style={{ width: '70px', padding: '4px' }}
                                  disabled={remaining === 0}
                                />
                              )}
                            </td>
                            <td>
                              <select
                                value={cur.condition}
                                onChange={(e) =>
                                  handleConditionChange(
                                    item.productId,
                                    e.target.value as 'restock' | 'damaged'
                                  )
                                }
                                style={{ padding: '4px' }}
                              >
                                <option value="restock">Restock (Add to stock)</option>
                                <option value="damaged">Damaged (Do not restock)</option>
                              </select>
                            </td>
                            <td className="fw-bold">{money((cur.serials?.length ?? cur.qty) * item.price)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div className="form-group" style={{ marginTop: '1rem' }}>
                    <label>Refund Payment Method</label>
                    <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
                      <option value="cash">Cash</option>
                      <option value="bank">Bank Transfer</option>
                      <option value="credit">Store Credit</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Reason for Return</label>
                    <input
                      type="text"
                      placeholder="e.g. Defective item, wrong size, customer changed mind"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </div>

                  <div className="modal-footer" style={{ marginTop: '1.25rem' }}>
                    <div className="total-highlight">
                      Refund Amount: <strong>{money(calculateTotalRefund())}</strong>
                    </div>
                    <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="primary-btn danger-style" disabled={busy}>
                      {busy ? 'Saving…' : 'Confirm & Issue Refund'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Return Receipt Modal */}
      {activeReceipt && (
        <div className="modal-backdrop" onClick={() => setActiveReceipt(null)}>
          <div className="modal-dialog receipt-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="receipt-view">
              <div className="receipt-header">
                <h3>{config.appName}</h3>
                <p className="small muted">REFUND RECEIPT</p>
                <div className="fw-mono small">Return #: {activeReceipt.number}</div>
                <div className="fw-mono small">Original Sale: {activeReceipt.saleNumber}</div>
                <div className="small muted">{fmtDate(activeReceipt.at)}</div>
              </div>
              <hr className="receipt-divider" />
              <div className="receipt-items">
                {activeReceipt.items.map((it) => (
                  <div key={it.productId} className="receipt-item-row">
                    <div>
                      <div>{it.name}</div>
                      <span className="small muted">
                        {it.qty} x {money(it.unitPrice)} ({it.condition})
                      </span>
                    </div>
                    <div className="fw-bold">{money(it.refundAmount)}</div>
                  </div>
                ))}
              </div>
              <hr className="receipt-divider" />
              <div className="receipt-total-row">
                <span>TOTAL REFUNDED:</span>
                <span className="fw-bold">{money(activeReceipt.totalRefunded)}</span>
              </div>
              <div className="receipt-meta small muted">
                Refunded via: {activeReceipt.paymentMethod}
                {activeReceipt.reason && <div>Reason: {activeReceipt.reason}</div>}
              </div>
              <div className="receipt-footer-buttons">
                <button className="primary-btn" onClick={() => window.print()}>
                  <Icon name="printer" size={15} /> Print receipt
                </button>
                <button className="btn-secondary" onClick={() => setActiveReceipt(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
