import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Sale } from '../db';
import { checkout } from '../actions';
import { config, formatMoney } from '../config';
import { printSale } from '../printing/print';
import { currentLocationId, listLocations } from '../location';

/** The shop's name for the receipt, only when there is more than one shop. */
async function shopLabel(): Promise<string | undefined> {
  const all = await listLocations();
  return all.length > 1 ? all.find((l) => l.id === currentLocationId())?.name : undefined;
}

export function Receipt({ sale, onClose, autoPrint = false }: { sale: Sale; onClose: () => void; autoPrint?: boolean }) {
  const direct = config.printer.mode !== 'browser';
  const [printMsg, setPrintMsg] = useState('');
  const print = async () => {
    setPrintMsg('');
    try {
      await printSale(sale, await shopLabel());
      if (direct) setPrintMsg('Sent to the printer.');
    } catch (e) {
      setPrintMsg(e instanceof Error ? e.message : 'Could not print');
    }
  };
  // straight after a sale, if the owner turned that on (never reprints when an old receipt is just viewed)
  useEffect(() => {
    if (autoPrint && direct && config.printer.auto) void print();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="modal" onClick={onClose}>
      <div className="receipt" onClick={(e) => e.stopPropagation()}>
        <h3>{config.appName}</h3>
        <div className="small muted">
          {sale.number} · {new Date(sale.at).toLocaleString(config.locale)}
        </div>
        <div className="small">Customer: {sale.customerName} · Paid by {sale.payment}</div>
        <hr />
        {sale.items.map((l) => (
          <div className="row" key={l.productId}>
            <span>
              {l.qty} × {l.name}
            </span>
            <span>{formatMoney(l.qty * l.price)}</span>
          </div>
        ))}
        <hr />
        <div className="row total">
          <span>Total</span>
          <span>{formatMoney(sale.total)}</span>
        </div>
        <p className="center small muted">{config.printer.footer || ''}</p>
        {printMsg && <p className="small no-print" role="status">{printMsg}</p>}
        <div className="actions no-print">
          <button onClick={() => void print()}>{direct ? 'Print receipt' : 'Print'}</button>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function Pos() {
  const products = useLiveQuery(() => db.products.toArray(), [], []);
  const customers = useLiveQuery(() => db.customers.toArray(), [], []);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [customer, setCustomer] = useState('');
  const [payment, setPayment] = useState('cash');
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Sale | null>(null);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? products.filter((p) => (p.name + ' ' + p.sku + ' ' + p.aliases.join(' ')).toLowerCase().includes(s)) : products;
  }, [products, q]);

  const add = (id: string, by = 1) =>
    setCart((c) => {
      const next = { ...c, [id]: (c[id] ?? 0) + by };
      if (next[id]! <= 0) delete next[id];
      return next;
    });

  const lines = Object.entries(cart).flatMap(([id, qty]) => {
    const p = byId.get(id);
    return p ? [{ p, qty }] : [];
  });
  const total = lines.reduce((s, l) => s + l.qty * l.p.price, 0);

  // USB barcode scanners type the code then press Enter
  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const code = q.trim();
    const hit = products.find((p) => p.sku && p.sku === code) ?? (shown.length === 1 ? shown[0] : undefined);
    if (hit) {
      add(hit.id);
      setQ('');
    }
  };

  const pay = async () => {
    setError('');
    try {
      const sale = await checkout({
        items: lines.map((l) => ({ productId: l.p.id, qty: l.qty })),
        customerName: customer,
        payment,
      });
      setReceipt(sale);
      setCart({});
      setCustomer('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
    }
  };

  return (
    <div className="pos">
      <section>
        <input
          className="search"
          placeholder="Search or scan barcode…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onSearchKey}
          autoFocus
        />
        {products.length === 0 && <p className="muted">No products yet. Add some in Products, or load demo data in Settings.</p>}
        <div className="grid">
          {shown.map((p) => (
            <button key={p.id} className="tile" onClick={() => add(p.id)} disabled={p.stock <= 0 && !config.allowNegativeStock}>
              <strong>{p.name}</strong>
              <span>{formatMoney(p.price)}</span>
              <span className={`small ${p.stock <= p.lowStockAt ? 'warn-text' : 'muted'}`}>{p.stock} in stock</span>
            </button>
          ))}
        </div>
      </section>

      <aside className="cart">
        <h3>Cart</h3>
        {lines.length === 0 && <p className="muted">Tap a product to add it.</p>}
        {lines.map(({ p, qty }) => (
          <div className="cart-line" key={p.id}>
            <div>
              <div>{p.name}</div>
              <div className="small muted">{formatMoney(p.price)} each</div>
            </div>
            <div className="qty">
              <button onClick={() => add(p.id, -1)}>−</button>
              <span>{qty}</span>
              <button onClick={() => add(p.id, 1)}>+</button>
            </div>
            <div className="line-total">{formatMoney(qty * p.price)}</div>
          </div>
        ))}
        {config.features.customers && (
          <>
            <input list="customers" placeholder="Customer (optional)" value={customer} onChange={(e) => setCustomer(e.target.value)} />
            <datalist id="customers">
              {customers.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </>
        )}
        <select value={payment} onChange={(e) => setPayment(e.target.value)}>
          <option value="cash">Cash</option>
          <option value="transfer">Transfer</option>
          <option value="pos">POS</option>
          <option value="card">Card</option>
          <option value="credit">Credit</option>
        </select>
        <div className="row total">
          <span>Total</span>
          <span>{formatMoney(total)}</span>
        </div>
        {error && <p className="error">{error}</p>}
        <button className="primary big" disabled={lines.length === 0} onClick={pay}>
          Charge {formatMoney(total)}
        </button>
        {lines.length > 0 && <button onClick={() => setCart({})}>Clear cart</button>}
      </aside>

      {receipt && <Receipt sale={receipt} autoPrint onClose={() => setReceipt(null)} />}
    </div>
  );
}
