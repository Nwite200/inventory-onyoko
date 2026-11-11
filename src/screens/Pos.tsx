import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Sale } from '../db';
import { checkout } from '../actions';
import { config, formatMoney } from '../config';
import { printSale } from '../printing/print';
import { currentLocationId, listLocations } from '../location';
import { t } from '../i18n';
import { expiredProductIds } from '../lots';

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
          <span>{t('pos.total')}</span>
          <span>{formatMoney(sale.total)}</span>
        </div>
        <p className="center small muted">{config.printer.footer || ''}</p>
        {printMsg && <p className="small no-print" role="status">{printMsg}</p>}
        <div className="actions no-print">
          <button onClick={() => void print()}>{direct ? t('receipt.printReceipt') : t('receipt.print')}</button>
          <button className="primary" onClick={onClose}>
            {t('receipt.done')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Pos() {
  const products = useLiveQuery(() => db.products.toArray(), [], []);
  const customers = useLiveQuery(() => db.customers.toArray(), [], []);
  const expired = useLiveQuery(async () => { await db.lots.count(); await db.products.count(); return expiredProductIds(); }, [], new Set<string>());
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
          placeholder={t('pos.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onSearchKey}
          autoFocus
        />
        {products.length === 0 && <p className="muted">{t('pos.noProducts')}</p>}
        <div className="grid">
          {shown.map((p) => (
            <button key={p.id} className="tile" onClick={() => add(p.id)} disabled={p.stock <= 0 && !config.allowNegativeStock}>
              <strong>{p.name}</strong>
              {expired.has(p.id) && <span className="small warn-text">⚠ {t('pos.expired')}</span>}
              <span>{formatMoney(p.price)}</span>
              <span className={`small ${p.stock <= p.lowStockAt ? 'warn-text' : 'muted'}`}>{t('pos.inStock', { n: p.stock })}</span>
            </button>
          ))}
        </div>
      </section>

      <aside className="cart">
        <h3>{t('pos.cart')}</h3>
        {lines.length === 0 && <p className="muted">{t('pos.tapToAdd')}</p>}
        {lines.map(({ p, qty }) => (
          <div className="cart-line" key={p.id}>
            <div>
              <div>{p.name}</div>
              <div className="small muted">{t('pos.each', { price: formatMoney(p.price) })}</div>
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
            <input list="customers" placeholder={t('pos.customer')} value={customer} onChange={(e) => setCustomer(e.target.value)} />
            <datalist id="customers">
              {customers.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </>
        )}
        <select value={payment} onChange={(e) => setPayment(e.target.value)}>
          <option value="cash">{t('pay.cash')}</option>
          <option value="transfer">{t('pay.transfer')}</option>
          <option value="pos">{t('pay.pos')}</option>
          <option value="card">{t('pay.card')}</option>
          <option value="credit">{t('pay.credit')}</option>
        </select>
        <div className="row total">
          <span>{t('pos.total')}</span>
          <span>{formatMoney(total)}</span>
        </div>
        {error && <p className="error">{error}</p>}
        <button className="primary big" disabled={lines.length === 0} onClick={pay}>
          {t('pos.charge', { amount: formatMoney(total) })}
        </button>
        {lines.length > 0 && <button onClick={() => setCart({})}>{t('pos.clear')}</button>}
      </aside>

      {receipt && <Receipt sale={receipt} autoPrint onClose={() => setReceipt(null)} />}
    </div>
  );
}
