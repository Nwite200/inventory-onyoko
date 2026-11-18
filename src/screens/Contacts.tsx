import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type Customer, type Supplier } from '../db';
import { config } from '../config';
import { Icon } from '../components/Icon';
import { customerStatement, recordCustomerPayment, type CustomerStatement } from '../documents';

export function Contacts() {
  const [activeTab, setActiveTab] = useState<'customers' | 'suppliers'>('customers');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showAddSupplier, setShowAddSupplier] = useState(false);

  // Form states
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cAddress, setCAddress] = useState('');
  const [cCreditLimit, setCCreditLimit] = useState('');

  const [sName, setSName] = useState('');
  const [sPhone, setSPhone] = useState('');
  const [paying, setPaying] = useState<Customer | null>(null);
  const [payForm, setPayForm] = useState({ amount: '', method: 'cash', reference: '' });
  const [statement, setStatement] = useState<{ name: string; data: CustomerStatement } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const customers = useLiveQuery(() => db.customers.toArray(), [], []);
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [], []);
  const purchases = useLiveQuery(() => db.purchases.toArray(), [], []);

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cName.trim()) return;

    const newCust: Customer = {
      id: uid(),
      name: cName.trim(),
      phone: cPhone.trim() || undefined,
      email: cEmail.trim() || undefined,
      address: cAddress.trim() || undefined,
      creditLimit: parseFloat(cCreditLimit) || 0,
    };

    await db.customers.add(newCust);
    await db.outbox.add({
      entity: 'customer',
      op: 'create',
      payload: newCust,
      at: Date.now(),
    });

    setShowAddCustomer(false);
    setCName('');
    setCPhone('');
    setCEmail('');
    setCAddress('');
    setCCreditLimit('');
  };

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sName.trim()) return;

    const newSup: Supplier = {
      id: uid(),
      name: sName.trim(),
      phone: sPhone.trim() || undefined,
    };

    await db.suppliers.add(newSup);
    await db.outbox.add({
      entity: 'supplier',
      op: 'create',
      payload: newSup,
      at: Date.now(),
    });

    setShowAddSupplier(false);
    setSName('');
    setSPhone('');
  };

  const filteredCustomers = (customers || []).filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.phone && c.phone.includes(searchTerm))
  );

  const filteredSuppliers = (suppliers || []).filter(
    (s) =>
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.phone && s.phone.includes(searchTerm))
  );

  const money = (val: number) =>
    `${config.currencySymbol}${Number(val).toLocaleString(config.locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  const openStatement = async (c: Customer) => {
    setErr('');
    try {
      setStatement({ name: c.name, data: await customerStatement(c.id) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not build the statement');
    }
  };

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paying || busy) return;
    setBusy(true);
    setErr('');
    try {
      await recordCustomerPayment({
        customerId: paying.id,
        customerName: paying.name,
        amount: Number(payForm.amount),
        method: payForm.method,
        reference: payForm.reference,
      });
      setPaying(null);
      setPayForm({ amount: '', method: 'cash', reference: '' });
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Could not record the payment');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="contacts-module">
      {err && <div className="alert-error" role="alert">{err}</div>}
      <div className="module-header">
        <div>
          <span className="eyebrow">Relationships</span>
          <h2>Contacts</h2>
          <p className="muted">Customer directory, credit limits and supplier relationships.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {activeTab === 'customers' ? (
            <button className="primary-btn" onClick={() => setShowAddCustomer(true)}>
              <Icon name="plus" size={15} /> Add customer
            </button>
          ) : (
            <button className="primary-btn" onClick={() => setShowAddSupplier(true)}>
              <Icon name="plus" size={15} /> Add supplier
            </button>
          )}
        </div>
      </div>

      {/* Sub-tab Switcher */}
      <div className="subtabs-bar">
        <button
          className={activeTab === 'customers' ? 'subtab active' : 'subtab'}
          onClick={() => setActiveTab('customers')}
        >
          <Icon name="users" size={15} /> Customers ({customers.length})
        </button>
        <button
          className={activeTab === 'suppliers' ? 'subtab active' : 'subtab'}
          onClick={() => setActiveTab('suppliers')}
        >
          <Icon name="truck" size={15} /> Suppliers ({suppliers.length})
        </button>
      </div>

      <div className="table-controls" style={{ marginTop: '1rem' }}>
        <input
          type="search"
          placeholder={`Search ${activeTab} by name or phone...`}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
      </div>

      {activeTab === 'customers' ? (
        <div className="table-container">
          <table className="modern-table">
            <thead>
              <tr>
                <th>Customer Name</th>
                <th>Phone Number</th>
                <th>Email</th>
                <th>Address</th>
                <th>Credit Limit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-table-cell">
                    No customers found. Add your first customer or complete a sale to record them.
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((c) => (
                  <tr key={c.id}>
                    <td className="fw-bold">{c.name}</td>
                    <td>{c.phone || <span className="muted">—</span>}</td>
                    <td>{c.email || <span className="muted">—</span>}</td>
                    <td>{c.address || <span className="muted">—</span>}</td>
                    <td>{c.creditLimit ? money(c.creditLimit) : <span className="muted">No limit</span>}</td>
                    <td className="num">
                      <div className="row-actions end">
                        <button className="btn btn-ghost btn-sm" onClick={() => { setPaying(c); setPayForm({ amount: '', method: 'cash', reference: '' }); }}>Payment</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => void openStatement(c)}>Statement</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-container">
          <table className="modern-table">
            <thead>
              <tr>
                <th>Supplier Name</th>
                <th>Phone Number</th>
                <th>Purchases Total</th>
                <th>Outstanding Balance Owed</th>
              </tr>
            </thead>
            <tbody>
              {filteredSuppliers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-table-cell">
                    No suppliers found. Add a supplier to receive goods and manage vendor payables.
                  </td>
                </tr>
              ) : (
                filteredSuppliers.map((s) => {
                  const supPurchases = (purchases || []).filter(
                    (p) => p.supplierId === s.id && p.status === 'received'
                  );
                  const totalBought = supPurchases.reduce((sum, p) => sum + p.total, 0);
                  const totalPaid = supPurchases.reduce((sum, p) => sum + (p.paid || 0), 0);
                  const owed = Math.max(0, totalBought - totalPaid);

                  return (
                    <tr key={s.id}>
                      <td className="fw-bold">{s.name}</td>
                      <td>{s.phone || <span className="muted">—</span>}</td>
                      <td>{money(totalBought)}</td>
                      <td className={owed > 0 ? 'text-danger fw-bold' : 'text-success'}>
                        {money(owed)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Customer Modal */}
      {showAddCustomer && (
        <div className="modal-backdrop">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3>Add New Customer</h3>
              <button className="close-btn" onClick={() => setShowAddCustomer(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleAddCustomer}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Full Name / Business Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Alhaji Musa or Mama Ngozi"
                    value={cName}
                    onChange={(e) => setCName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Phone Number</label>
                  <input
                    type="tel"
                    placeholder="e.g. 08012345678"
                    value={cPhone}
                    onChange={(e) => setCPhone(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Email Address</label>
                  <input
                    type="email"
                    placeholder="e.g. customer@example.com"
                    value={cEmail}
                    onChange={(e) => setCEmail(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Delivery Address</label>
                  <input
                    type="text"
                    placeholder="Street, City, State"
                    value={cAddress}
                    onChange={(e) => setCAddress(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Credit Limit ({config.currencySymbol})</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="0 = No credit"
                    value={cCreditLimit}
                    onChange={(e) => setCCreditLimit(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowAddCustomer(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Save Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Supplier Modal */}
      {showAddSupplier && (
        <div className="modal-backdrop">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3>Add New Supplier</h3>
              <button className="close-btn" onClick={() => setShowAddSupplier(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleAddSupplier}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Supplier / Vendor Company Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Dangote Sugar Distributors"
                    value={sName}
                    onChange={(e) => setSName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Phone Number</label>
                  <input
                    type="tel"
                    placeholder="e.g. 08098765432"
                    value={sPhone}
                    onChange={(e) => setSPhone(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowAddSupplier(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Save Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {paying && (
        <div className="modal-backdrop" onClick={() => setPaying(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Record customer payment">
            <form onSubmit={submitPayment}>
              <header className="modal-header">
                <div><h3>Record payment</h3><p className="panel-sub">{paying.name}</p></div>
                <button type="button" className="icon-btn" onClick={() => setPaying(null)} aria-label="Close"><Icon name="close" size={16} /></button>
              </header>
              <div className="modal-body">
                <label className="field"><span>Amount ({config.currencySymbol})</span><input type="number" min="0" step="any" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} required autoFocus /></label>
                <div className="form-grid two-col">
                  <label className="field"><span>Method</span><select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}><option value="cash">Cash</option><option value="transfer">Bank transfer</option><option value="card">Card</option><option value="pos">POS</option></select></label>
                  <label className="field"><span>Reference</span><input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} /></label>
                </div>
                <p className="panel-sub">The payment is allocated to the oldest credit invoices and posted to accounts receivable.</p>
              </div>
              <footer className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setPaying(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {statement && (
        <div className="modal-backdrop" onClick={() => setStatement(null)}>
          <div className="modal-dialog receipt-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="receipt-view">
              <div className="receipt">
                <div className="receipt-header">
                  <h3>Customer statement</h3>
                  <p className="receipt-meta">{statement.name}</p>
                  <p className="receipt-meta">As at {new Date().toLocaleDateString()}</p>
                </div>
                <hr className="receipt-divider" />
                <div className="statement-mini">
                  <div className="receipt-total-row"><span>Invoiced</span><span>{money(statement.data.invoiced)}</span></div>
                  <div className="receipt-total-row"><span>Credit notes</span><span>−{money(statement.data.refunded)}</span></div>
                  <div className="receipt-total-row"><span>Payments</span><span>−{money(statement.data.paid)}</span></div>
                  <div className="receipt-total-row grand"><span>Outstanding</span><span>{money(statement.data.outstanding)}</span></div>
                </div>
                <hr className="receipt-divider" />
                {statement.data.rows.length === 0 ? <p className="small muted">No credit activity.</p> : statement.data.rows.map((r, i) => (
                  <div className="statement-row" key={`${r.ref}-${i}`}>
                    <span>{new Date(r.at).toLocaleDateString()} · {r.ref}</span>
                    <span className={r.debit ? '' : 'text-success'}>{r.debit ? money(r.debit) : `−${money(r.credit)}`} · {money(r.balance)}</span>
                  </div>
                ))}
              </div>
              <div className="receipt-footer-buttons no-print">
                <button className="btn btn-ghost" onClick={() => window.print()}><Icon name="printer" size={15} /> Print</button>
                <button className="btn btn-primary" onClick={() => setStatement(null)}>Done</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
