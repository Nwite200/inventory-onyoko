import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid } from '../db';
import { config } from '../config';
import { Icon } from '../components/Icon';
import { recordExpense } from '../expenses';
import { requestApproval, APPROVAL_REQUIRED } from '../approvals';
import { getSession } from '../auth';

const EXPENSE_CATEGORIES = [
  'Utilities (Electricity/Water)',
  'Rent & Lease',
  'Salaries & Wages',
  'Repairs & Maintenance',
  'Logistics & Transport',
  'Packaging & Supplies',
  'Marketing & Advertising',
  'Taxes & Licences',
  'Miscellaneous',
];

export function Expenses() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Form state
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [expenseId, setExpenseId] = useState('');

  const expenses = useLiveQuery(
    () => db.expenses.orderBy('at').reverse().toArray(),
    [],
    []
  );

  const filteredExpenses = (expenses || []).filter((exp) => {
    const matchesCat = filterCategory === 'all' || exp.category === filterCategory;
    const matchesSearch =
      !searchTerm ||
      exp.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (exp.note && exp.note.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  const totalExpenseAmount = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid amount greater than zero');
      return;
    }

    const id = expenseId || uid();
    setExpenseId(id);
    try {
      await recordExpense({
        id,
        category,
        amount: parsedAmount,
        paymentMethod,
        note,
        createdBy: getSession()?.username,
      });
      setShowAddModal(false);
      setAmount('');
      setNote('');
      setExpenseId('');
      setError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save the expense';
      if (message.startsWith(APPROVAL_REQUIRED)) {
        try {
          await requestApproval({
            kind: 'expense',
            entityId: id,
            summary: `Expense — ${category} (${config.currencySymbol}${parsedAmount.toLocaleString()})`,
            amount: parsedAmount,
          });
          setError('Approval requested. A manager can approve it in Advanced → Approvals, then save again.');
        } catch (e) {
          setError(e instanceof Error ? e.message : message);
        }
      } else {
        setError(message);
      }
    }
  };

  const money = (val: number) =>
    `${config.currencySymbol}${Number(val).toLocaleString(config.locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  const fmtDate = (at: number) =>
    new Date(at).toLocaleDateString(config.locale, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="expenses-module">
      <div className="module-header">
        <div>
          <span className="eyebrow">Finance</span>
          <h2>Expenses</h2>
          <p className="muted">Operational costs, overheads and disbursements — posted to the ledger automatically.</p>
        </div>
        <button className="primary-btn" onClick={() => { setExpenseId(uid()); setError(''); setShowAddModal(true); }}>
          <Icon name="plus" size={15} /> Record expense
        </button>
      </div>

      {/* Summary Metrics */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: '1.25rem' }}>
        <div className="kpi-card accent-rose">
          <div className="kpi-icon"><Icon name="wallet" size={17} /></div>
          <div className="kpi-content">
            <span className="kpi-label">Filtered expenses</span>
            <div className="kpi-value">{money(totalExpenseAmount)}</div>
            <span className="kpi-hint">{filteredExpenses.length} records</span>
          </div>
        </div>
        <div className="kpi-card accent-indigo">
          <div className="kpi-icon"><Icon name="chart" size={17} /></div>
          <div className="kpi-content">
            <span className="kpi-label">Categories tracked</span>
            <div className="kpi-value">{EXPENSE_CATEGORIES.length}</div>
            <span className="kpi-hint">Standard cost centers</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="table-controls">
        <input
          type="search"
          placeholder="Search by description or category..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="filter-select"
        >
          <option value="all">All Categories</option>
          {EXPENSE_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {/* Expenses Table */}
      <div className="table-container">
        <table className="modern-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Description / Note</th>
              <th>Payment Method</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {filteredExpenses.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-table-cell">
                  No expense records found.
                </td>
              </tr>
            ) : (
              filteredExpenses.map((exp) => (
                <tr key={exp.id}>
                  <td className="muted small">{fmtDate(exp.at)}</td>
                  <td>
                    <span className="badge badge-category">{exp.category}</span>
                  </td>
                  <td>{exp.note || <span className="muted">—</span>}</td>
                  <td>
                    <span className="badge badge-subtle">{exp.paymentMethod}</span>
                  </td>
                  <td className="fw-bold text-danger" style={{ textAlign: 'right' }}>
                    {money(exp.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Expense Modal */}
      {showAddModal && (
        <div className="modal-backdrop">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3>Record Business Expense</h3>
              <button className="close-btn" onClick={() => setShowAddModal(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleAddExpense}>
              <div className="modal-body">
                {error && <div className="alert-error">{error}</div>}
                <div className="form-group">
                  <label>Category</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Amount ({config.currencySymbol})</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g. 5000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Payment Method</label>
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    <option value="cash">Cash (Drawer)</option>
                    <option value="bank">Bank Transfer</option>
                    <option value="card">Card / POS</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Notes / Purpose</label>
                  <textarea
                    rows={3}
                    placeholder="What was this expense for? (e.g. generator fuel, office paper)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Save Expense
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

