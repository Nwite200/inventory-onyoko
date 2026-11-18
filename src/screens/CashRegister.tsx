import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type CashRegister } from '../db';
import { config } from '../config';
import { currentLocationId } from '../location';
import { getSession } from '../auth';
import { Icon } from '../components/Icon';

export function CashRegisterScreen() {
  const [openingFloat, setOpeningFloat] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [closingNote, setClosingNote] = useState('');
  const [error, setError] = useState('');

  const session = getSession();
  const currentUserId = session?.username || 'local-cashier';
  const locationId = currentLocationId();

  // Active open register for current location & user
  const activeRegister = useLiveQuery(
    () =>
      db.registers
        .where('status')
        .equals('open')
        .filter((r) => r.locationId === locationId)
        .first(),
    [locationId]
  );

  // Past closed registers
  const pastRegisters = useLiveQuery(
    () =>
      db.registers
        .where('status')
        .equals('closed')
        .reverse()
        .sortBy('closedAt'),
    []
  );

  // Live cash movements during active register session
  const shiftMetrics = useLiveQuery(async () => {
    if (!activeRegister) return null;

    const startTime = activeRegister.openedAt;

    // Cash sales for this branch only, so a register never reconciles another shop's takings.
    const sales = await db.sales
      .filter((s) => s.at >= startTime && s.status === 'completed' && s.payment.toLowerCase().includes('cash') && (s.locationId ?? 'main') === locationId)
      .toArray();
    const cashSalesTotal = sales.reduce((sum, s) => sum + s.total, 0);

    // Cash refunds
    const returns = await db.returns
      .filter((r) => r.at >= startTime && r.status === 'completed' && r.paymentMethod === 'cash' && (r.locationId ?? 'main') === locationId)
      .toArray();
    const cashRefundsTotal = returns.reduce((sum, r) => sum + r.totalRefunded, 0);

    // Cash expenses
    const expenses = await db.expenses
      .filter((e) => e.at >= startTime && e.paymentMethod === 'cash' && (e.locationId ?? 'main') === locationId)
      .toArray();
    const cashExpensesTotal = expenses.reduce((sum, e) => sum + e.amount, 0);

    const expectedCash = activeRegister.openingCash + cashSalesTotal - cashRefundsTotal - cashExpensesTotal;

    return {
      cashSalesTotal,
      salesCount: sales.length,
      cashRefundsTotal,
      refundsCount: returns.length,
      cashExpensesTotal,
      expensesCount: expenses.length,
      expectedCash,
    };
  }, [activeRegister]);

  const handleOpenRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const floatVal = parseFloat(openingFloat);
    if (isNaN(floatVal) || floatVal < 0) {
      setError('Please enter a valid opening float cash amount (or 0).');
      return;
    }

    const newRegister: CashRegister = {
      id: uid(),
      userId: currentUserId,
      locationId,
      openedAt: Date.now(),
      openingCash: floatVal,
      status: 'open',
    };

    await db.registers.add(newRegister);
    await db.outbox.add({
      entity: 'cash_register',
      op: 'open',
      payload: newRegister,
      at: Date.now(),
    });

    setOpeningFloat('');
    setError('');
  };

  const handleCloseRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRegister || !shiftMetrics) return;

    const counted = parseFloat(closingCash);
    if (isNaN(counted) || counted < 0) {
      setError('Please enter the physical cash counted in drawer.');
      return;
    }

    const updated: CashRegister = {
      ...activeRegister,
      closedAt: Date.now(),
      closingCash: counted,
      expectedCash: shiftMetrics.expectedCash,
      status: 'closed',
      notes: closingNote.trim() || undefined,
    };

    await db.registers.put(updated);
    await db.outbox.add({
      entity: 'cash_register',
      op: 'close',
      payload: updated,
      at: Date.now(),
    });

    setClosingCash('');
    setClosingNote('');
    setError('');
  };

  const money = (val: number) =>
    `${config.currencySymbol}${Number(val).toLocaleString(config.locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  const fmtDate = (at?: number) =>
    at
      ? new Date(at).toLocaleDateString(config.locale, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';

  return (
    <div className="register-module">
      <div className="module-header">
        <div>
          <span className="eyebrow">Cash control</span>
          <h2>Cash register</h2>
          <p className="muted">Opening floats, cash collected and end-of-shift reconciliation.</p>
        </div>
      </div>

      {error && <div className="alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* If No Register is Open */}
      {!activeRegister ? (
        <div className="register-closed-card">
          <div className="closed-icon"><Icon name="lock" size={22} /></div>
          <h3>Cash register is closed</h3>
          <p className="muted">
            Open the register for this branch to record cash sales and reconcile the drawer at the end of the shift.
          </p>
          <form onSubmit={handleOpenRegister} className="open-register-form">
            <div className="form-group">
              <label>Opening Cash Float ({config.currencySymbol})</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 10000"
                value={openingFloat}
                onChange={(e) => setOpeningFloat(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="primary-btn big-btn">
              <Icon name="lock" size={16} /> Open register shift
            </button>
          </form>
        </div>
      ) : (
        /* If Register is Currently Open */
        <div className="register-active-section">
          <div className="register-status-banner">
            <div>
              <span className="badge badge-success">● Register Active</span>
              <span className="muted small" style={{ marginLeft: '10px' }}>
                Opened by <strong>{activeRegister.userId}</strong> on {fmtDate(activeRegister.openedAt)}
              </span>
            </div>
          </div>

          <div className="kpi-grid" style={{ margin: '1.25rem 0' }}>
            <div className="kpi-card accent-blue">
              <div className="kpi-icon"><Icon name="banknote" size={18} /></div>
              <div className="kpi-content">
                <span className="kpi-label">Opening Float</span>
                <div className="kpi-value">{money(activeRegister.openingCash)}</div>
                <span className="kpi-hint">Shift start cash</span>
              </div>
            </div>

            <div className="kpi-card accent-emerald">
              <div className="kpi-icon"><Icon name="cart" size={18} /></div>
              <div className="kpi-content">
                <span className="kpi-label">Cash Sales</span>
                <div className="kpi-value">{money(shiftMetrics?.cashSalesTotal ?? 0)}</div>
                <span className="kpi-hint">{shiftMetrics?.salesCount ?? 0} cash sales</span>
              </div>
            </div>

            <div className="kpi-card accent-amber">
              <div className="kpi-icon"><Icon name="refund" size={18} /></div>
              <div className="kpi-content">
                <span className="kpi-label">Cash Refunds</span>
                <div className="kpi-value">{money(shiftMetrics?.cashRefundsTotal ?? 0)}</div>
                <span className="kpi-hint">{shiftMetrics?.refundsCount ?? 0} refunded</span>
              </div>
            </div>

            <div className="kpi-card accent-rose">
              <div className="kpi-icon"><Icon name="wallet" size={18} /></div>
              <div className="kpi-content">
                <span className="kpi-label">Cash Expenses</span>
                <div className="kpi-value">{money(shiftMetrics?.cashExpensesTotal ?? 0)}</div>
                <span className="kpi-hint">{shiftMetrics?.expensesCount ?? 0} disbursements</span>
              </div>
            </div>

            <div className="kpi-card accent-indigo" style={{ gridColumn: 'span 2' }}>
              <div className="kpi-icon"><Icon name="banknote" size={18} /></div>
              <div className="kpi-content">
                <span className="kpi-label">Expected drawer total</span>
                <div className="kpi-value">{money(shiftMetrics?.expectedCash ?? 0)}</div>
                <span className="kpi-hint">Float + Sales - Refunds - Expenses</span>
              </div>
            </div>
          </div>

          {/* Close Register Form */}
          <div className="card" style={{ maxWidth: '600px', margin: '0 auto 2rem' }}>
            <h3>Close Register / End Shift</h3>
            <p className="muted small">Count all cash physically present in the drawer and enter below.</p>
            <form onSubmit={handleCloseRegister} className="form">
              <div className="form-group">
                <label>Physical Cash Counted ({config.currencySymbol})</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Enter counted cash amount"
                  value={closingCash}
                  onChange={(e) => setClosingCash(e.target.value)}
                  required
                />
              </div>

              {closingCash && shiftMetrics && (
                <div className="reconciliation-preview">
                  <span>Calculated Discrepancy: </span>
                  {(() => {
                    const diff = parseFloat(closingCash) - shiftMetrics.expectedCash;
                    if (Math.abs(diff) < 0.01) {
                      return <strong className="text-success">Exact Match (0.00)</strong>;
                    } else if (diff > 0) {
                      return <strong className="text-success">+{money(diff)} (Cash Surplus)</strong>;
                    } else {
                      return <strong className="text-danger">{money(diff)} (Cash Shortage)</strong>;
                    }
                  })()}
                </div>
              )}

              <div className="form-group">
                <label>Shift Notes / Explanation</label>
                <textarea
                  rows={2}
                  placeholder="Optional shift handover or variance notes..."
                  value={closingNote}
                  onChange={(e) => setClosingNote(e.target.value)}
                />
              </div>

              <button type="submit" className="primary-btn danger-style big-btn">
                <Icon name="lock" size={16} /> Reconcile & close register
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Register Shift History */}
      <div className="table-container" style={{ marginTop: '2rem' }}>
        <h3 style={{ padding: '1rem', margin: 0, borderBottom: '1px solid var(--border)' }}>
          Past Register Shift History
        </h3>
        <table className="modern-table">
          <thead>
            <tr>
              <th>Opened</th>
              <th>Closed</th>
              <th>Cashier</th>
              <th>Opening Float</th>
              <th>Expected Cash</th>
              <th>Counted Cash</th>
              <th>Discrepancy</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {(!pastRegisters || pastRegisters.length === 0) ? (
              <tr>
                <td colSpan={8} className="empty-table-cell">
                  No closed register shifts yet.
                </td>
              </tr>
            ) : (
              pastRegisters.map((reg) => {
                const diff = (reg.closingCash ?? 0) - (reg.expectedCash ?? 0);
                return (
                  <tr key={reg.id}>
                    <td className="muted small">{fmtDate(reg.openedAt)}</td>
                    <td className="muted small">{fmtDate(reg.closedAt)}</td>
                    <td>{reg.userId}</td>
                    <td>{money(reg.openingCash)}</td>
                    <td>{money(reg.expectedCash ?? 0)}</td>
                    <td className="fw-bold">{money(reg.closingCash ?? 0)}</td>
                    <td className={diff >= 0 ? 'text-success fw-bold' : 'text-danger fw-bold'}>
                      {diff >= 0 ? `+${money(diff)}` : money(diff)}
                    </td>
                    <td className="muted small">{reg.notes || '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
