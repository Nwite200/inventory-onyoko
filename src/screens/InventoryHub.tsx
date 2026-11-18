import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid } from '../db';
import { config, formatMoney } from '../config';
import { adjustStock } from '../actions';
import { requestApproval, APPROVAL_REQUIRED } from '../approvals';
import { listLocations } from '../location';
import { Transfers } from './Transfers';
import { Icon } from '../components/Icon';

export function InventoryHub() {
  const [activeTab, setActiveTab] = useState<'ledger' | 'adjust' | 'expiry' | 'transfers'>('ledger');
  const [searchTerm, setSearchTerm] = useState('');

  // Adjustment form
  const [adjProductId, setAdjProductId] = useState('');
  const [adjDelta, setAdjDelta] = useState('');
  const [adjReason, setAdjReason] = useState('reconciliation');
  const [adjNote, setAdjNote] = useState('');
  const [adjMessage, setAdjMessage] = useState('');
  const [adjustKey, setAdjustKey] = useState('');

  const products = useLiveQuery(() => db.products.toArray(), [], []);
  const locations = useLiveQuery(() => listLocations(), [], []);
  const movements = useLiveQuery(
    () => db.stockMovements.orderBy('at').reverse().limit(100).toArray(),
    [],
    []
  );
  const lots = useLiveQuery(() => db.lots.orderBy('expiresAt').toArray(), [], []);

  const handleStockAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    const deltaNum = parseInt(adjDelta);
    if (!adjProductId || isNaN(deltaNum) || deltaNum === 0) {
      setAdjMessage('Please select a product and enter a non-zero adjustment quantity (+ or -).');
      return;
    }

    const prod = products.find((p) => p.id === adjProductId);
    const reasonStr = `adjustment:${adjReason}${adjNote ? ` (${adjNote})` : ''}`;
    const key = adjustKey || uid();
    setAdjustKey(key);
    setAdjMessage('');
    try {
      await adjustStock(adjProductId, deltaNum, reasonStr, undefined, key);
      setAdjMessage(`Successfully adjusted stock for ${prod?.name || 'Product'} by ${deltaNum > 0 ? `+${deltaNum}` : deltaNum}.`);
      setAdjDelta('');
      setAdjNote('');
      setAdjustKey('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not adjust stock';
      if (message.startsWith(APPROVAL_REQUIRED)) {
        try {
          await requestApproval({ kind: 'stock_adjustment', entityId: key, summary: `Stock adjustment — ${prod?.name ?? 'Product'} (${deltaNum > 0 ? '+' : ''}${deltaNum})`, amount: Math.abs(deltaNum) * (prod?.cost ?? 0) });
          setAdjMessage('Approval requested. A manager can approve it in Advanced → Approvals, then apply again.');
        } catch (e) {
          setAdjMessage(e instanceof Error ? e.message : message);
        }
      } else {
        setAdjMessage(message);
      }
    }
  };

  const getProductName = (id: string) => products.find((p) => p.id === id)?.name || id;
  const getLocationName = (id?: string) => locations.find((l) => l.id === id)?.name || 'Main Shop';

  const fmtDate = (at: number) =>
    new Date(at).toLocaleDateString(config.locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const summary = useMemo(() => ({
    value: products.reduce((s, p) => s + Math.max(0, p.stock) * p.cost, 0),
    units: products.reduce((s, p) => s + Math.max(0, p.stock), 0),
    low: products.filter((p) => p.stock > 0 && p.stock <= p.lowStockAt).length,
    expiring: lots.filter((l) => l.expiresAt < now + thirtyDaysMs).length,
  }), [products, lots, now, thirtyDaysMs]);

  return (
    <div className="inventory-hub">
      <header className="page-head">
        <div>
          <span className="eyebrow">Stock control</span>
          <h1>Inventory</h1>
          <p className="lede">A movement ledger for every branch, with adjustments, batches and transfers.</p>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-ghost" onClick={() => setActiveTab('adjust')}><Icon name="clipboard" size={15} /> Adjust stock</button>
          <button className="btn btn-primary" onClick={() => setActiveTab('transfers')}><Icon name="truck" size={16} /> Transfer stock</button>
        </div>
      </header>

      <section className="summary-strip">
        <div><span className="fi-label">Stock value</span><strong>{formatMoney(summary.value)}</strong><span className="fi-sub">At cost, this branch</span></div>
        <div><span className="fi-label">Units on hand</span><strong>{summary.units}</strong><span className="fi-sub">{products.length} products</span></div>
        <div><span className="fi-label">Low stock</span><strong className={summary.low ? 'text-amber' : ''}>{summary.low}</strong><span className="fi-sub">Reorder soon</span></div>
        <div><span className="fi-label">Expiring lots</span><strong className={summary.expiring ? 'text-amber' : ''}>{summary.expiring}</strong><span className="fi-sub">Within 30 days</span></div>
      </section>

      {/* Subtab Navigation */}
      <div className="subtabs-bar">
        <button
          className={activeTab === 'ledger' ? 'subtab active' : 'subtab'}
          onClick={() => setActiveTab('ledger')}
        >
          <Icon name="history" size={15} /> Movement ledger
        </button>
        <button
          className={activeTab === 'adjust' ? 'subtab active' : 'subtab'}
          onClick={() => setActiveTab('adjust')}
        >
          <Icon name="clipboard" size={15} /> Stock adjustment
        </button>
        <button
          className={activeTab === 'expiry' ? 'subtab active' : 'subtab'}
          onClick={() => setActiveTab('expiry')}
        >
          <Icon name="alert" size={15} /> Batches & expiry
        </button>
        <button
          className={activeTab === 'transfers' ? 'subtab active' : 'subtab'}
          onClick={() => setActiveTab('transfers')}
        >
          <Icon name="truck" size={15} /> Transfers
        </button>
      </div>

      {/* Ledger Tab */}
      {activeTab === 'ledger' && (
        <div style={{ marginTop: '1rem' }}>
          <div className="table-controls">
            <input
              type="search"
              placeholder="Filter movements by product or reason..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
          <div className="table-container">
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Product</th>
                  <th>Shop Location</th>
                  <th>Change (Delta)</th>
                  <th>Reason / Operation</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {(!movements || movements.length === 0) ? (
                  <tr>
                    <td colSpan={6} className="empty-table-cell">
                      No stock movements recorded yet.
                    </td>
                  </tr>
                ) : (
                  movements
                    .filter((m) => {
                      const pName = getProductName(m.productId).toLowerCase();
                      const reason = m.reason.toLowerCase();
                      const term = searchTerm.toLowerCase();
                      return !searchTerm || pName.includes(term) || reason.includes(term);
                    })
                    .map((m) => (
                      <tr key={m.id}>
                        <td className="muted small">{fmtDate(m.at)}</td>
                        <td className="fw-bold">{getProductName(m.productId)}</td>
                        <td>{getLocationName(m.locationId)}</td>
                        <td className={m.delta > 0 ? 'text-success fw-bold' : 'text-danger fw-bold'}>
                          {m.delta > 0 ? `+${m.delta}` : m.delta}
                        </td>
                        <td>
                          <span className="badge badge-subtle">{m.reason.replace(/[:_]/g, ' ')}</span>
                        </td>
                        <td className="muted small fw-mono">{m.ref ? m.ref.slice(0, 8) : '—'}</td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stock Adjustment Tab */}
      {activeTab === 'adjust' && (
        <div style={{ marginTop: '1rem', maxWidth: '640px', margin: '1rem auto' }}>
          <div className="card">
            <h3>Record Physical Stock Adjustment</h3>
            <p className="muted small">
              Use this when physical counts differ from recorded stock (spoilage, count reconciliation, damage, or found stock). Every adjustment is recorded in the permanent audit ledger.
            </p>
            {adjMessage && <div className="alert-success" style={{ margin: '10px 0' }}>{adjMessage}</div>}
            <form onSubmit={handleStockAdjustment} className="form">
              <div className="form-group">
                <label>Select Product *</label>
                <select
                  value={adjProductId}
                  onChange={(e) => setAdjProductId(e.target.value)}
                  required
                >
                  <option value="">-- Choose Product --</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Current Stock: {p.stock})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Adjustment Quantity (+ to add, - to subtract) *</label>
                <input
                  type="number"
                  placeholder="e.g. -3 for damaged items or +5 for found stock"
                  value={adjDelta}
                  onChange={(e) => setAdjDelta(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Reason Category</label>
                <select value={adjReason} onChange={(e) => setAdjReason(e.target.value)}>
                  <option value="reconciliation">Physical Inventory Count Reconciliation</option>
                  <option value="damaged">Damaged / Broken in Store</option>
                  <option value="expired">Expired Stock Removal</option>
                  <option value="shrinkage">Loss / Shrinkage</option>
                  <option value="found">Unrecorded Stock Found</option>
                </select>
              </div>

              <div className="form-group">
                <label>Additional Notes / Audit Reference</label>
                <input
                  type="text"
                  placeholder="e.g. Broken during shelf reorganization"
                  value={adjNote}
                  onChange={(e) => setAdjNote(e.target.value)}
                />
              </div>

              <button type="submit" className="primary-btn big-btn">
                Apply Stock Adjustment
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Expiry Tab */}
      {activeTab === 'expiry' && (
        <div style={{ marginTop: '1rem' }}>
          <div className="table-container">
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Batch / Lot #</th>
                  <th>Initial Batch Qty</th>
                  <th>Expiry Date</th>
                  <th>Status</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {(!lots || lots.length === 0) ? (
                  <tr>
                    <td colSpan={6} className="empty-table-cell">
                      No batch lots recorded. Receive goods with batch numbers to track expiration dates.
                    </td>
                  </tr>
                ) : (
                  lots.map((lot) => {
                    const isExpired = lot.expiresAt < now;
                    const isNearExpiry = !isExpired && lot.expiresAt < now + thirtyDaysMs;
                    return (
                      <tr key={lot.id}>
                        <td className="fw-bold">{getProductName(lot.productId)}</td>
                        <td className="fw-mono">{lot.batchNo || '—'}</td>
                        <td>{lot.qty}</td>
                        <td>{new Date(lot.expiresAt).toLocaleDateString(config.locale)}</td>
                        <td>
                          {isExpired ? (
                            <span className="badge badge-danger">EXPIRED</span>
                          ) : isNearExpiry ? (
                            <span className="badge badge-warning">Expires Soon</span>
                          ) : (
                            <span className="badge badge-success">Good</span>
                          )}
                        </td>
                        <td>{getLocationName(lot.locationId)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transfers Tab */}
      {activeTab === 'transfers' && (
        <div style={{ marginTop: '1rem' }}>
          <Transfers />
        </div>
      )}
    </div>
  );
}
