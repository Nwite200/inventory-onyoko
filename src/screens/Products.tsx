import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { addProduct, adjustStock, deleteProduct, setPrice } from '../actions';
import { formatMoney } from '../config';
import { t } from '../i18n';
import { Labels } from './Labels';
import { addLot, parseDay } from '../lots';

const blank = { name: '', sku: '', price: '', cost: '', unit: 'pcs', stock: '', low: '5', aliases: '' };

export function Products({ canManage }: { canManage: boolean }) {
  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), [], []);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [labels, setLabels] = useState(false);
  const [lot, setLot] = useState({ productId: '', qty: '', batch: '', date: '' });
  const [adjust, setAdjust] = useState<Record<string, string>>({});

  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

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
    void run(async () => {
      await addProduct({
        name: form.name,
        sku: form.sku,
        price: Number(form.price),
        cost: Number(form.cost) || 0,
        unit: form.unit,
        openingStock: Number(form.stock) || 0,
        lowStockAt: Number(form.low) || 0,
        aliases: form.aliases.split(','),
      });
      setForm(blank);
    });
  };

  return (
    <div>
      {canManage ? (
        <form className="card form" onSubmit={submit}>
          <h3>{t('products.add')}</h3>
          <input placeholder={t('products.name')} value={form.name} onChange={set('name')} required />
          <input placeholder={t('products.sku')} value={form.sku} onChange={set('sku')} />
          <input placeholder={t('products.price')} type="number" min="0" step="any" value={form.price} onChange={set('price')} required />
          <input placeholder={t('products.cost')} type="number" min="0" step="any" value={form.cost} onChange={set('cost')} />
          <input placeholder={t('products.unit')} value={form.unit} onChange={set('unit')} />
          <input placeholder={t('products.opening')} type="number" step="any" value={form.stock} onChange={set('stock')} />
          <input placeholder={t('products.low')} type="number" min="0" value={form.low} onChange={set('low')} />
          <input placeholder="Spoken names, comma separated (rice, bag of rice)" value={form.aliases} onChange={set('aliases')} />
          <button className="primary">Save product</button>
        </form>
      ) : (
        <p className="muted">Your role can view products but not change them.</p>
      )}
      {canManage && products.length > 0 && (
        <details className="card">
          <summary>{t('lot.add')}</summary>
          <form className="form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await addLot({ productId: lot.productId, qty: Number(lot.qty), batchNo: lot.batch, expiresAt: parseDay(lot.date) ?? NaN }); setLot({ productId: '', qty: '', batch: '', date: '' }); }); }}>
            <select aria-label="Product" value={lot.productId} onChange={(e) => setLot({ ...lot, productId: e.target.value })} required>
              <option value="">…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input aria-label="Quantity" type="number" min="0" step="any" placeholder="Qty" value={lot.qty} onChange={(e) => setLot({ ...lot, qty: e.target.value })} required />
            <input aria-label={t('lot.batch')} placeholder={t('lot.batch')} value={lot.batch} onChange={(e) => setLot({ ...lot, batch: e.target.value })} />
            <input aria-label={t('lot.expiry')} type="date" value={lot.date} onChange={(e) => setLot({ ...lot, date: e.target.value })} required />
            <button className="primary">{t('lot.save')}</button>
          </form>
        </details>
      )}
      {error && <p className="error">{error}</p>}
      {canManage && products.length > 0 && <p><button onClick={() => setLabels(true)}>Print barcode labels</button></p>}
      {labels && <Labels onClose={() => setLabels(false)} />}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('products.product')}</th>
              <th>{t('products.priceCol')}</th>
              <th>{t('products.stock')}</th>
              {canManage && <th>{t('products.adjust')}</th>}
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.name}</strong>
                  <div className="small muted">
                    {p.sku && `${p.sku} · `}
                    {p.aliases.join(', ')}
                  </div>
                </td>
                <td>
                  {canManage ? (
                    <input
                      className="narrow"
                      type="number"
                      min="0"
                      step="any"
                      defaultValue={p.price}
                      key={p.updatedAt}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v !== p.price) void run(() => setPrice(p.id, v));
                      }}
                    />
                  ) : (
                    formatMoney(p.price)
                  )}
                </td>
                <td className={p.stock <= p.lowStockAt ? 'warn-text' : ''}>
                  {p.stock} {p.unit}
                </td>
                {canManage && (
                  <td className="adjust">
                    <input
                      className="narrow"
                      type="number"
                      step="any"
                      placeholder="+10 / −3"
                      value={adjust[p.id] ?? ''}
                      onChange={(e) => setAdjust({ ...adjust, [p.id]: e.target.value })}
                    />
                    <button
                      onClick={() =>
                        void run(async () => {
                          await adjustStock(p.id, Number(adjust[p.id]), 'adjustment');
                          setAdjust({ ...adjust, [p.id]: '' });
                        })
                      }
                    >
                      Apply
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        if (confirm(`Delete ${p.name}?`)) void run(() => deleteProduct(p.id));
                      }}
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {products.length === 0 && <p className="muted">No products yet.</p>}
      </div>
    </div>
  );
}
