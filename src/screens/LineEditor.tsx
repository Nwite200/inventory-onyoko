import { useState } from 'react';
import type { Product } from '../db';
import { parseDay } from '../lots';
import { t } from '../i18n';

export interface Line {
  productId: string;
  qty: number;
  cost?: number;
  batchNo?: string;
  expiresAt?: number;
}

/** Pick a product, a quantity (and optionally a unit cost), add it to a list. Shared by Purchases and Transfers. */
export function LineEditor({ products, lines, onChange, withCost }: { products: Product[]; lines: Line[]; onChange: (l: Line[]) => void; withCost?: boolean }) {
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
    <div className="form">
      {lines.map((l, i) => (
        <div className="row" key={i}>
          <span>
            {byId.get(l.productId)?.name ?? '?'} × {l.qty}
            {withCost ? ` @ ${l.cost}` : ''}
            {l.batchNo ? ` · ${l.batchNo}` : ''}
            {l.expiresAt ? ` · ⏳ ${new Date(l.expiresAt).toLocaleDateString()}` : ''}
          </span>
          <button type="button" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label="Remove line">✕</button>
        </div>
      ))}
      <div className="row-btns">
        <select aria-label="Product" value={productId} onChange={(e) => pick(e.target.value)} style={{ flex: '2 1 160px' }}>
          <option value="">Choose product…</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.stock} here)</option>)}
        </select>
        <input aria-label="Quantity" className="narrow" type="number" min="0" step="any" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
        {withCost && <input aria-label="Cost each" className="narrow" type="number" min="0" step="any" placeholder="Cost each" value={cost} onChange={(e) => setCost(e.target.value)} />}
        {withCost && <input aria-label={t('lot.batch')} placeholder={t('lot.batch')} value={batch} onChange={(e) => setBatch(e.target.value)} style={{ flex: '1 1 120px' }} />}
        {withCost && <input aria-label={t('lot.expiry')} title={t('lot.expiry')} type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />}
        <button type="button" onClick={add}>Add line</button>
      </div>
    </div>
  );
}
