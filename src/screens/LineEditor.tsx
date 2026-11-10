import { useState } from 'react';
import type { Product } from '../db';

export interface Line {
  productId: string;
  qty: number;
  cost?: number;
}

/** Pick a product, a quantity (and optionally a unit cost), add it to a list. Shared by Purchases and Transfers. */
export function LineEditor({ products, lines, onChange, withCost }: { products: Product[]; lines: Line[]; onChange: (l: Line[]) => void; withCost?: boolean }) {
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const byId = new Map(products.map((p) => [p.id, p]));

  const pick = (id: string) => {
    setProductId(id);
    if (withCost) setCost(String(byId.get(id)?.cost || ''));
  };
  const add = () => {
    const q = Number(qty);
    if (!productId || !(q > 0)) return;
    onChange([...lines, { productId, qty: q, ...(withCost ? { cost: Number(cost) || 0 } : {}) }]);
    setProductId('');
    setQty('');
    setCost('');
  };

  return (
    <div className="form">
      {lines.map((l, i) => (
        <div className="row" key={i}>
          <span>
            {byId.get(l.productId)?.name ?? '?'} × {l.qty}
            {withCost ? ` @ ${l.cost}` : ''}
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
        <button type="button" onClick={add}>Add line</button>
      </div>
    </div>
  );
}
