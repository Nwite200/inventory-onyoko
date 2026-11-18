import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid } from '../db';
import { addProduct, adjustStock, deleteProduct, setPrice } from '../actions';
import { config, formatMoney } from '../config';
import { t } from '../i18n';
import { Labels } from './Labels';
import { addLot, parseDay } from '../lots';
import { Icon } from '../components/Icon';
import type { CSSProperties } from 'react';
import { requestApproval, APPROVAL_REQUIRED } from '../approvals';

const blank = { name: '', category: '', sku: '', price: '', taxRateId: '', cost: '', unit: 'pcs', stock: '', low: '5', aliases: '', trackSerials: false };

const hueFor = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

export function Products({ canManage }: { canManage: boolean }) {
  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), [], []);
  const taxRates = useLiveQuery(() => db.taxRates.toArray(), [], []);
  const storedCategories = useLiveQuery(() => db.categories.toArray(), [], []);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [labels, setLabels] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [adjustKey, setAdjustKey] = useState('');
  const [adjust, setAdjust] = useState({ qty: '', reason: 'adjustment:reconciliation', note: '' });
  const [lot, setLot] = useState({ productId: '', qty: '', batch: '', date: '' });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category).filter(Boolean) as string[]);
    for (const c of storedCategories) set.add(c.name);
    return Array.from(set).sort();
  }, [products, storedCategories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== 'All' && p.category !== category) return false;
      if (stockFilter === 'low' && !(p.stock > 0 && p.stock <= p.lowStockAt)) return false;
      if (stockFilter === 'out' && p.stock > 0) return false;
      if (!q) return true;
      return `${p.name} ${p.sku} ${p.category ?? ''} ${p.aliases.join(' ')}`.toLowerCase().includes(q);
    });
  }, [products, search, category, stockFilter]);

  const totals = useMemo(() => ({
    cost: products.reduce((s, p) => s + Math.max(0, p.stock) * p.cost, 0),
    retail: products.reduce((s, p) => s + Math.max(0, p.stock) * p.price, 0),
    low: products.filter((p) => p.stock > 0 && p.stock <= p.lowStockAt).length,
    out: products.filter((p) => p.stock <= 0).length,
  }), [products]);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    void run(async () => {
      await addProduct({
        name: form.name,
        sku: form.sku,
        category: form.category,
        price: Number(form.price),
        cost: Number(form.cost) || 0,
        unit: form.unit,
        ...(form.taxRateId ? { taxRateId: form.taxRateId } : {}),
        trackSerials: form.trackSerials,
        openingStock: Number(form.stock) || 0,
        lowStockAt: Number(form.low) || 0,
        aliases: form.aliases.split(','),
      });
      setForm(blank);
      setAddOpen(false);
    }).finally(() => setBusy(false));
  };

  const applyAdjust = async (productId: string) => {
    const delta = Number(adjust.qty);
    if (!delta) {
      setError('Enter a non-zero quantity to adjust');
      return;
    }
    const key = adjustKey || uid();
    setAdjustKey(key);
    const product = products.find((p) => p.id === productId);
    setError('');
    try {
      await adjustStock(productId, delta, adjust.reason === 'adjustment:reconciliation' && adjust.note ? `adjustment:${adjust.note}` : adjust.reason, undefined, key);
      setAdjusting(null);
      setAdjustKey('');
      setAdjust({ qty: '', reason: 'adjustment:reconciliation', note: '' });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not adjust stock';
      if (message.startsWith(APPROVAL_REQUIRED)) {
        try {
          await requestApproval({ kind: 'stock_adjustment', entityId: key, summary: `Stock adjustment — ${product?.name ?? productId} (${delta > 0 ? '+' : ''}${delta})`, amount: Math.abs(delta) * (product?.cost ?? 0) });
          setError('Approval requested. A manager can approve it in Advanced → Approvals, then apply again.');
        } catch (err) {
          setError(err instanceof Error ? err.message : message);
        }
      } else {
        setError(message);
      }
    }
  };

  const current = products.find((p) => p.id === adjusting);

  return (
    <div className="products-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Catalogue</span>
          <h1>Products</h1>
          <p className="lede">{products.length} products · {money(totals.cost)} at cost · {money(totals.retail)} at retail.</p>
        </div>
        <div className="page-head-actions">
          {canManage && (
            <>
              <button className="btn btn-ghost" onClick={() => setBatchOpen(true)}>
                <Icon name="package" size={16} /> Add batch
              </button>
              <button className="btn btn-ghost" onClick={() => setLabels(true)}>
                <Icon name="barcode" size={16} /> Labels
              </button>
              <button className="btn btn-primary" onClick={() => { setForm(blank); setAddOpen(true); }}>
                <Icon name="plus" size={16} /> Add product
              </button>
            </>
          )}
        </div>
      </header>

      <section className="summary-strip">
        <div><span className="fi-label">Products</span><strong>{products.length}</strong><span className="fi-sub">{categories.length} categories</span></div>
        <div><span className="fi-label">Inventory at cost</span><strong>{money(totals.cost)}</strong><span className="fi-sub">Retail {money(totals.retail)}</span></div>
        <div><span className="fi-label">Low stock</span><strong className={totals.low ? 'text-amber' : ''}>{totals.low}</strong><span className="fi-sub">At or below reorder level</span></div>
        <div><span className="fi-label">Out of stock</span><strong className={totals.out ? 'text-danger' : ''}>{totals.out}</strong><span className="fi-sub">Needs replenishment</span></div>
      </section>

      <div className="catalog-toolbar">
        <div className="pos-search compact-search">
          <Icon name="search" size={16} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, SKU, category or alias…" aria-label="Search products" />
          {search && <button className="icon-btn" onClick={() => setSearch('')} aria-label="Clear search"><Icon name="close" size={13} /></button>}
        </div>
        <div className="catalog-filters">
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="All">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value as typeof stockFilter)} aria-label="Stock level">
            <option value="all">All stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>
          <span className="muted small">{filtered.length} shown</span>
        </div>
      </div>

      {error && <div className="alert-error" role="alert">{error}</div>}

      <div className="table-container">
        <table className="data-table products-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th className="num">Price</th>
              {canManage && <th className="num">Cost</th>}
              <th>Stock</th>
              <th>Status</th>
              {canManage && <th className="num">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const low = p.stock > 0 && p.stock <= p.lowStockAt;
              const out = p.stock <= 0;
              return (
                <tr key={p.id}>
                  <td>
                    <div className="product-cell">
                      <span className="cl-art" style={{ '--h': hueFor(p.name) } as CSSProperties}>{p.name.slice(0, 2).toUpperCase()}</span>
                      <span>
                        <strong>{p.name}</strong>
                        <small className="muted">{p.sku ? `${p.sku} · ` : ''}{p.aliases.slice(0, 2).join(', ') || p.unit}</small>
                        {p.trackSerials && <span className="tag tag-serial">Serial tracked</span>}
                      </span>
                    </div>
                  </td>
                  <td>{p.category ? <span className="badge badge-category">{p.category}</span> : <span className="muted">—</span>}</td>
                  <td className="num">
                    {canManage ? (
                      <span className="price-edit">
                        <span>{config.currencySymbol}</span>
                        <input
                          className="inline-price"
                          type="number"
                          min="0"
                          step="any"
                          defaultValue={p.price}
                          key={p.updatedAt}
                          aria-label={`Price for ${p.name}`}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (v !== p.price) void run(() => setPrice(p.id, v));
                          }}
                        />
                      </span>
                    ) : formatMoney(p.price)}
                  </td>
                  {canManage && <td className="num muted">{formatMoney(p.cost)}</td>}
                  <td>
                    <span className={`stock-pill ${out ? 'out' : low ? 'low' : ''}`}>{p.stock} {p.unit}</span>
                    {low && <div className="muted small">reorder at {p.lowStockAt}</div>}
                  </td>
                  <td>
                    {out ? <span className="badge badge-danger">Out</span> : low ? <span className="badge badge-warning">Low</span> : <span className="badge badge-success">In stock</span>}
                  </td>
                  {canManage && (
                    <td className="num">
                      <div className="row-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => { setAdjusting(p.id); setAdjustKey(uid()); setAdjust({ qty: '', reason: 'adjustment:reconciliation', note: '' }); }}>
                          Adjust
                        </button>
                        <button className="icon-btn danger-hover" onClick={() => { if (confirm(`Delete ${p.name}? Existing sales keep their history.`)) void run(() => deleteProduct(p.id)); }} aria-label={`Delete ${p.name}`}>
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={canManage ? 7 : 5} className="empty-table-cell">No products match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {addOpen && (
        <div className="modal-backdrop" onClick={() => setAddOpen(false)}>
          <div className="modal-dialog modal-large" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add product">
            <form onSubmit={submit}>
              <header className="modal-header">
                <div><h3>Add product</h3><p className="panel-sub">Opening stock is recorded as a movement in this branch.</p></div>
                <button type="button" className="icon-btn" onClick={() => setAddOpen(false)} aria-label="Close"><Icon name="close" size={16} /></button>
              </header>
              <div className="modal-body">
                <div className="form-grid two-col">
                  <label className="field"><span>{t('products.name')}</span><input value={form.name} onChange={set('name')} required autoFocus /></label>
                  <label className="field"><span>Category</span><input list="product-categories" placeholder="e.g. Drinks" value={form.category} onChange={set('category')} />
                    <datalist id="product-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
                  </label>
                  <label className="field"><span>{t('products.sku')}</span><input value={form.sku} onChange={set('sku')} placeholder="Scan or type" /></label>
                  <label className="field"><span>{t('products.unit')}</span><input value={form.unit} onChange={set('unit')} /></label>
                  <label className="field"><span>Tax rule</span>
                    <select value={form.taxRateId} onChange={(e) => setForm({ ...form, taxRateId: e.target.value })}>
                      <option value="">No tax</option>
                      {taxRates.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name} · {r.rate}% {r.inclusive ? 'incl.' : 'excl.'}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>{t('products.price')}</span><input type="number" min="0" step="any" value={form.price} onChange={set('price')} required /></label>
                  <label className="field"><span>{t('products.cost')}</span><input type="number" min="0" step="any" value={form.cost} onChange={set('cost')} /></label>
                  <label className="field"><span>{t('products.opening')}</span><input type="number" step="any" value={form.stock} onChange={set('stock')} /></label>
                  <label className="field"><span>{t('products.low')}</span><input type="number" min="0" value={form.low} onChange={set('low')} /></label>
                </div>
                <label className="field"><span>Spoken names</span><input placeholder="rice, bag of rice" value={form.aliases} onChange={set('aliases')} /><small className="muted">Used by search, barcode matching and the voice assistant.</small></label>
                <label className="check-field">
                  <input type="checkbox" checked={form.trackSerials} onChange={(e) => setForm({ ...form, trackSerials: e.target.checked })} />
                  <span><strong>Track serial numbers</strong><small>The till requires a serial for every unit sold, and returns restore it.</small></span>
                </label>
              </div>
              <footer className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setAddOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save product'}</button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {current && (
        <div className="modal-backdrop" onClick={() => setAdjusting(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Adjust stock">
            <header className="modal-header">
              <div><h3>Adjust stock</h3><p className="panel-sub">{current.name} · {current.stock} {current.unit} on hand</p></div>
              <button className="icon-btn" onClick={() => setAdjusting(null)} aria-label="Close"><Icon name="close" size={16} /></button>
            </header>
            <div className="modal-body">
              <label className="field"><span>Change (+ to add, − to remove)</span><input type="number" step="any" value={adjust.qty} onChange={(e) => setAdjust({ ...adjust, qty: e.target.value })} placeholder="e.g. -2 or 12" autoFocus /></label>
              <label className="field"><span>Reason</span>
                <select value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })}>
                  <option value="adjustment:reconciliation">Stock count reconciliation</option>
                  <option value="adjustment:damaged">Damaged / broken</option>
                  <option value="adjustment:expired">Expired</option>
                  <option value="adjustment:shrinkage">Loss / shrinkage</option>
                  <option value="adjustment:found">Unrecorded stock found</option>
                </select>
              </label>
              <label className="field"><span>Note (optional)</span><input value={adjust.note} onChange={(e) => setAdjust({ ...adjust, note: e.target.value })} placeholder="Audit reference" /></label>
              <p className="panel-sub">Every adjustment is written to the movement ledger and posted to accounting.</p>
            </div>
            <footer className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setAdjusting(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void applyAdjust(current.id)}>Apply adjustment</button>
            </footer>
          </div>
        </div>
      )}

      {batchOpen && (
        <div className="modal-backdrop" onClick={() => setBatchOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add batch">
            <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await addLot({ productId: lot.productId, qty: Number(lot.qty), batchNo: lot.batch, expiresAt: parseDay(lot.date) ?? NaN }); setLot({ productId: '', qty: '', batch: '', date: '' }); setBatchOpen(false); }); }}>
              <header className="modal-header">
                <div><h3>Add a batch</h3><p className="panel-sub">Track expiry dates for medicines and perishables.</p></div>
                <button type="button" className="icon-btn" onClick={() => setBatchOpen(false)} aria-label="Close"><Icon name="close" size={16} /></button>
              </header>
              <div className="modal-body">
                <label className="field"><span>Product</span>
                  <select value={lot.productId} onChange={(e) => setLot({ ...lot, productId: e.target.value })} required>
                    <option value="">Choose a product…</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <div className="form-grid two-col">
                  <label className="field"><span>Quantity</span><input type="number" min="0" step="any" value={lot.qty} onChange={(e) => setLot({ ...lot, qty: e.target.value })} required /></label>
                  <label className="field"><span>{t('lot.batch')}</span><input value={lot.batch} onChange={(e) => setLot({ ...lot, batch: e.target.value })} /></label>
                </div>
                <label className="field"><span>{t('lot.expiry')}</span><input type="date" value={lot.date} onChange={(e) => setLot({ ...lot, date: e.target.value })} required /></label>
              </div>
              <footer className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setBatchOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{t('lot.save')}</button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {labels && <Labels onClose={() => setLabels(false)} />}
    </div>
  );
}

function money(n: number): string {
  return formatMoney(Math.round(n * 100) / 100);
}
