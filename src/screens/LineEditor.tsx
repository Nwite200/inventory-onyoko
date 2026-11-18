import { useState } from 'react';
import type { Product } from '../db';
import { parseDay } from '../lots';
import { t } from '../i18n';
import { Icon } from '../components/Icon';

export interface Line {
  productId: string;
  qty: number;
  cost?: number;
  batchNo?: string;
  expiresAt?: number;
}

/** Pick a product, a quantity (and optionally a unit cost), add it to a list. Shared by Purchases and Transfers. */
export function LineEditor({ products, lines, onChange, withCost, costLabel }: { products: Product[]; lines: Line[]; onChange: (l: Line[]) => void; withCost?: boolean; costLabel?: string }) {
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [batch, setBatch] = useState('');
  const [expiry, setExpiry] = useState('');
  const byId = new Map(products.map((p) => [p.id, p]));

  const pick = (id: string) => {
    setProductId(id);
    if (withCost) setCost(String(byId.get(id)?.cost || ''));
  };
  const add = () => {
    const q = Number(qty);
    if (!productId || !(q > 0)) return;
    const exp = withCost ? parseDay(expiry) : undefined;
    onChange([...lines, { productId, qty: q, ...(withCost ? { cost: Number(cost) || 0 } : {}), ...(exp ? { expiresAt: exp } : {}), ...(withCost && batch.trim() ? { batchNo: batch.trim() } : {}) }]);
    setProductId('');
    setQty('');
    setCost('');
    setBatch('');
    setExpiry('');
  };

  return (
    <div className="line-editor">
      {lines.length > 0 && (
        <ul className="line-list">
          {lines.map((l, i) => (
            <li key={i}>
              <span className="line-main">
                <strong>{byId.get(l.productId)?.name ?? 'Unknown product'}</strong>
                <small>
                  {l.qty} units{withCost ? ` @ ${l.cost ?? 0}` : ''}{l.batchNo ? ` · ${l.batchNo}` : ''}{l.expiresAt ? ` · expires ${new Date(l.expiresAt).toLocaleDateString()}` : ''}
                </small>
              </span>
              <button type="button" className="icon-btn" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label="Remove line">
                <Icon name="close" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="line-fields">
        <label className="field line-product">
          <span>Product</span>
          <select aria-label="Product" value={productId} onChange={(e) => pick(e.target.value)}>
            <option value="">Choose product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.stock} in stock)</option>)}
          </select>
        </label>
        <label className="field">
          <span>Quantity</span>
          <input aria-label="Quantity" type="number" min="0" step="any" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        {withCost && (
          <label className="field">
            <span>{costLabel ?? 'Unit cost'}</span>
            <input aria-label="Cost each" type="number" min="0" step="any" placeholder="0.00" value={cost} onChange={(e) => setCost(e.target.value)} />
          </label>
        )}
        {withCost && (
          <label className="field">
            <span>{t('lot.batch')}</span>
            <input aria-label={t('lot.batch')} placeholder="Optional" value={batch} onChange={(e) => setBatch(e.target.value)} />
          </label>
        )}
        {withCost && (
          <label className="field">
            <span>{t('lot.expiry')}</span>
            <input aria-label={t('lot.expiry')} type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </label>
        )}
        <button type="button" className="btn btn-secondary line-add" onClick={add} disabled={!productId || !(Number(qty) > 0)}>
          <Icon name="plus" size={14} /> Add line
        </button>
      </div>
    </div>
  );
}
