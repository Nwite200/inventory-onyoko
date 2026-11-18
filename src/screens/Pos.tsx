import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type Sale } from '../db';
import { checkout } from '../actions';
import { config, formatMoney } from '../config';
import { printSale } from '../printing/print';
import { currentLocationId, listLocations } from '../location';
import { t } from '../i18n';
import { expiredProductIds } from '../lots';
import { getSession } from '../auth';
import { Icon } from '../components/Icon';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { computeSaleTotals } from '../tax';
import { QrCode } from '../components/QrCode';
import type { CSSProperties } from 'react';

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
  useEffect(() => {
    if (autoPrint && direct && config.printer.auto) void print();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const subtotal = sale.subtotal ?? sale.total;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog receipt-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Receipt">
        <div className="receipt-view">
          <div className={`receipt receipt-${config.branding.receiptTemplate}`}>
            <div className="receipt-brand">
              {config.branding.showLogo && (config.branding.logo || config.branding.loginLogo) && <img className="receipt-logo" src={config.branding.logo || config.branding.loginLogo} alt="" />}
              <div>
                <h3>{config.branding.businessName || config.appName}</h3>
                {config.branding.showAddress && config.branding.address && <p className="receipt-meta">{config.branding.address}</p>}
                {config.branding.showPhone && config.branding.phone && <p className="receipt-meta">{config.branding.phone}</p>}
              </div>
            </div>
            <div className="receipt-header">
              <p className="receipt-meta">{sale.number} · {new Date(sale.at).toLocaleString(config.locale)}</p>
              <p className="receipt-meta">{sale.customerName} · {sale.payment}</p>
            </div>
            <hr className="receipt-divider" />
            <div className="receipt-items">
              {sale.items.map((l) => (
                <div className="receipt-item-row" key={l.productId + l.price}>
                  <span>{l.qty} × {l.name}</span>
                  <span>{formatMoney(l.qty * l.price)}</span>
                </div>
              ))}
            </div>
            <hr className="receipt-divider" />
            {subtotal !== sale.total && (sale.discount ?? 0) > 0 && (
              <div className="receipt-total-row"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>
            )}
            {(sale.discount ?? 0) > 0 && <div className="receipt-total-row"><span>Discount</span><span>−{formatMoney(sale.discount ?? 0)}</span></div>}
            {(sale.tax ?? 0) > 0 && config.branding.showTax && <div className="receipt-total-row"><span>Tax included</span><span>{formatMoney(sale.tax ?? 0)}</span></div>}
            <div className="receipt-total-row grand"><span>{t('pos.total')}</span><span>{formatMoney(sale.total)}</span></div>
            {sale.currency && sale.foreignTotal !== undefined && (
              <div className="receipt-total-row"><span>{sale.currency} @ {sale.fxRate}</span><span>{sale.currency} {sale.foreignTotal.toLocaleString(config.locale, { maximumFractionDigits: 2 })}</span></div>
            )}
            {sale.payments && sale.payments.length > 1 && (
              <div className="receipt-payments">
                {sale.payments.map((p, i) => <div className="receipt-total-row" key={`${p.method}-${i}`}><span>{p.method}</span><span>{formatMoney(p.amount)}</span></div>)}
              </div>
            )}
            <p className="center small muted">{config.branding.footer || config.printer.footer || ''}</p>
            {config.branding.showQr && (
              <div className="receipt-qr"><QrCode text={config.branding.qrText || `${config.branding.website || config.appName}/${sale.number}`} size={78} /></div>
            )}
          </div>
          {printMsg && <p className="small muted center" role="status">{printMsg}</p>}
          <div className="receipt-footer-buttons no-print">
            <button className="btn btn-ghost" onClick={() => void print()}>
              <Icon name="printer" size={15} /> {direct ? t('receipt.printReceipt') : t('receipt.print')}
            </button>
            <button className="btn btn-primary" onClick={onClose}>{t('receipt.done')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface HeldCart {
  id: string;
  at: number;
  customer: string;
  cart: Record<string, number>;
  serials?: Record<string, string[]>;
}

const HELD_KEY = 'openpos.held';

function readHeld(): HeldCart[] {
  try {
    const v = JSON.parse(localStorage.getItem(HELD_KEY) ?? '[]') as HeldCart[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeHeld(list: HeldCart[]): void {
  localStorage.setItem(HELD_KEY, JSON.stringify(list));
}

const hueFor = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

const PAYMENTS: { id: string; label: string; icon: 'banknote' | 'card' | 'wallet' | 'creditCard' | 'register' }[] = [
  { id: 'cash', label: 'Cash', icon: 'banknote' },
  { id: 'transfer', label: 'Transfer', icon: 'wallet' },
  { id: 'card', label: 'Card', icon: 'creditCard' },
  { id: 'pos', label: 'POS', icon: 'register' },
  { id: 'credit', label: 'Credit', icon: 'card' },
];

export function Pos() {
  const products = useLiveQuery(() => db.products.toArray(), [], []);
  const customers = useLiveQuery(() => db.customers.toArray(), [], []);
  const expired = useLiveQuery(async () => { await db.lots.count(); await db.products.count(); return expiredProductIds(); }, [], new Set<string>());
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartSerials, setCartSerials] = useState<Record<string, string[]>>({});
  const [pickerId, setPickerId] = useState<string | null>(null);
  const [pickerSelected, setPickerSelected] = useState<string[]>([]);
  const [customer, setCustomer] = useState('');
  const [payment, setPayment] = useState('cash');
  const [category, setCategory] = useState('All');
  const [discountMode, setDiscountMode] = useState<'none' | 'percent' | 'amount'>('none');
  const [discountValue, setDiscountValue] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [heldOpen, setHeldOpen] = useState(false);
  const [held, setHeld] = useState<HeldCart[]>(readHeld);
  const [busy, setBusy] = useState(false);
  const [cartVisible, setCartVisible] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [split, setSplit] = useState(false);
  const [tenders, setTenders] = useState<{ method: string; amount: string }[]>([{ method: 'cash', amount: '' }, { method: 'transfer', amount: '' }]);
  const [currency, setCurrency] = useState('');
  const allTaxRates = useLiveQuery(() => db.taxRates.toArray(), [], []);
  const currencies = useLiveQuery(() => db.currencies.toArray(), [], []);
  const serialOptions = useLiveQuery(
    async () => (pickerId ? (await db.serials.where('productId').equals(pickerId).toArray()).filter((s) => s.status === 'in_stock' && s.locationId === currentLocationId()) : []),
    [pickerId],
    [],
  );
  const pickerProduct = pickerId ? products.find((p) => p.id === pickerId) : undefined;
  const searchRef = useRef<HTMLInputElement>(null);
  const cartRef = useRef<HTMLElement>(null);
  const payRef = useRef<HTMLButtonElement>(null);
  const session = getSession();

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category?.trim()).filter(Boolean) as string[]);
    return ['All', ...Array.from(set).sort()];
  }, [products]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== 'All' && p.category !== category) return false;
      return s ? (p.name + ' ' + p.sku + ' ' + p.aliases.join(' ')).toLowerCase().includes(s) : true;
    });
  }, [products, q, category]);

  const add = (id: string, by = 1) => {
    const p = byId.get(id);
    if (p?.trackSerials && by > 0) {
      setPickerId(id);
      setPickerSelected([]);
      return;
    }
    if (p?.trackSerials && by < 0) {
      setCartSerials((s) => {
        const list = [...(s[id] ?? [])];
        list.pop();
        return { ...s, [id]: list };
      });
    }
    setCart((c) => {
      const next = { ...c, [id]: (c[id] ?? 0) + by };
      if (next[id]! <= 0) delete next[id];
      return next;
    });
  };

  const confirmSerials = () => {
    if (!pickerProduct || pickerSelected.length === 0) return;
    setCart((c) => ({ ...c, [pickerProduct.id]: (c[pickerProduct.id] ?? 0) + pickerSelected.length }));
    setCartSerials((s) => ({ ...s, [pickerProduct.id]: [...(s[pickerProduct.id] ?? []), ...pickerSelected] }));
    setPickerId(null);
    setPickerSelected([]);
  };

  const removeLine = (productId: string) => {
    setCart((c) => { const n = { ...c }; delete n[productId]; return n; });
    setCartSerials((s) => { const n = { ...s }; delete n[productId]; return n; });
  };

  const lines = Object.entries(cart).flatMap(([id, qty]) => {
    const p = byId.get(id);
    return p ? [{ p, qty }] : [];
  });
  const subtotal = Math.round(lines.reduce((s, l) => s + l.qty * l.p.price, 0) * 100) / 100;
  const rawDiscount = Number(discountValue) || 0;
  const requestedDiscount = discountMode === 'percent' ? (subtotal * rawDiscount) / 100 : rawDiscount;
  const totals = computeSaleTotals(lines.map((l) => ({ productId: l.p.id, qty: l.qty, price: l.p.price, ...(l.p.taxRateId ? { taxRateId: l.p.taxRateId } : {}) })), requestedDiscount, allTaxRates);
  const discount = totals.discount;
  const tax = totals.tax;
  const total = totals.total;
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const received = Number(cashReceived) || 0;
  const change = received - total;
  const selectedCurrency = currencies.find((c) => c.code === currency);
  const foreignTotal = selectedCurrency ? Math.round((total / selectedCurrency.rate) * 100) / 100 : 0;
  const tenderTotal = split ? Math.round(tenders.reduce((s, t) => s + (Number(t.amount) || 0), 0) * 100) / 100 : total;

  const reset = () => {
    setCart({});
    setCartSerials({});
    setCustomer('');
    setDiscountMode('none');
    setDiscountValue('');
    setCashReceived('');
    setSplit(false);
    setTenders([{ method: 'cash', amount: '' }, { method: 'transfer', amount: '' }]);
    setCurrency('');
    setPickerId(null);
    setPickerSelected([]);
  };

  const pay = async () => {
    if (busy) return;
    setError('');
    const splitPayments = split ? tenders.filter((t) => Number(t.amount) > 0).map((t) => ({ method: t.method, amount: Number(t.amount) })) : undefined;
    if (split && Math.abs(tenderTotal - total) > 0.005) {
      setError(`Payments add up to ${formatMoney(tenderTotal)}, but the total is ${formatMoney(total)}.`);
      return;
    }
    if ((payment === 'credit' || splitPayments?.some((p) => p.method === 'credit')) && !customer.trim()) {
      setError('Choose a customer for a credit sale.');
      return;
    }
    if (!split && payment === 'cash' && cashReceived !== '' && received < total) {
      setError('Cash received is less than the total.');
      return;
    }
    setBusy(true);
    try {
      const sale = await checkout({
        items: lines.map((l) => ({ productId: l.p.id, qty: l.qty, ...(l.p.taxRateId ? { taxRateId: l.p.taxRateId } : {}), ...(l.p.trackSerials ? { serials: cartSerials[l.p.id] ?? [] } : {}) })),
        customerName: customer,
        payment,
        discount,
        ...(splitPayments ? { payments: splitPayments } : {}),
        ...(selectedCurrency ? { currency: selectedCurrency.code, fxRate: selectedCurrency.rate } : {}),
        cashier: session?.username,
      });
      setReceipt(sale);
      reset();
      searchRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
    } finally {
      setBusy(false);
    }
  };

  const hold = () => {
    if (lines.length === 0) return;
    const entry: HeldCart = { id: uid(), at: Date.now(), customer, cart, serials: cartSerials };
    const next = [entry, ...held].slice(0, 20);
    setHeld(next);
    writeHeld(next);
    reset();
  };

  const resume = (entry: HeldCart) => {
    setCart(entry.cart);
    setCartSerials(entry.serials ?? {});
    setCustomer(entry.customer);
    setHeldOpen(false);
    searchRef.current?.focus();
  };

  const removeHeld = (id: string) => {
    const next = held.filter((h) => h.id !== id);
    setHeld(next);
    writeHeld(next);
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const code = q.trim();
    const hit = products.find((p) => p.sku && p.sku === code) ?? (shown.length === 1 ? shown[0] : undefined);
    if (hit) {
      add(hit.id);
      setQ('');
    }
  };

  useEffect(() => {
    const el = payRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setCartVisible(Boolean(entry?.isIntersecting)), { threshold: 0.9 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (e.key === 'F4' && lines.length > 0 && !receipt) {
        e.preventDefault();
        void pay();
      }
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'SELECT') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="pos">
      <section className="pos-catalog">
        <div className="pos-search">
          <Icon name="search" size={18} />
          <input
            ref={searchRef}
            placeholder={t('pos.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onSearchKey}
            autoFocus
            aria-label={t('pos.search')}
          />
          <span className="kbd">F2</span>
          <button type="button" className="icon-btn scanner-btn" onClick={() => setScannerOpen(true)} title="Scan barcode with camera" aria-label="Scan barcode with camera">
            <Icon name="camera" size={18} />
          </button>
        </div>

        <div className="pos-toolbar">
          <div className="chip-row">
            {categories.map((c) => (
              <button key={c} className={`chip ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>{c}</button>
            ))}
          </div>
          <div className="pos-toolbar-actions">
            <span className="muted small">{shown.length} items</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setHeldOpen(true)}>
              <Icon name="history" size={14} /> Held {held.length > 0 ? `(${held.length})` : ''}
            </button>
          </div>
        </div>

        {products.length === 0 ? (
          <div className="empty-state">
            <span className="empty-ico"><Icon name="products" size={22} /></span>
            <strong>No products yet</strong>
            <p>{t('pos.noProducts')}</p>
          </div>
        ) : (
          <div className="product-grid">
            {shown.map((p) => {
              const low = p.stock <= p.lowStockAt;
              return (
                <button
                  key={p.id}
                  className="product-tile"
                  onClick={() => add(p.id)}
                  disabled={p.stock <= 0 && !config.allowNegativeStock}
                  style={{ '--h': hueFor(p.name) } as CSSProperties}
                >
                  <span className="product-art">
                    <span>{p.name.slice(0, 2).toUpperCase()}</span>
                  </span>
                  <span className="product-info">
                    <strong className="product-name">{p.name}</strong>
                    <span className="product-meta">
                      <span className="product-price">{formatMoney(p.price)}</span>
                      <span className={`stock-pill ${p.stock <= 0 ? 'out' : low ? 'low' : ''}`}>{p.stock} {p.unit}</span>
                    </span>
                    {expired.has(p.id) && <span className="tag tag-warn">Expired stock</span>}
                    {p.trackSerials && <span className="tag tag-serial">Serial</span>}
                  </span>
                  <span className="product-add"><Icon name="plus" size={15} /></span>
                </button>
              );
            })}
            {shown.length === 0 && <p className="muted">No products match "{q}".</p>}
          </div>
        )}
      </section>

      <aside className="pos-cart" ref={cartRef}>
        <header className="cart-head">
          <div>
            <h2>Current sale</h2>
            <span className="muted small">{itemCount} item{itemCount === 1 ? '' : 's'}</span>
          </div>
          <div className="cart-head-actions">
            <button className="btn btn-ghost btn-sm" onClick={hold} disabled={lines.length === 0} title="Hold this sale">
              <Icon name="clipboard" size={14} /> Hold
            </button>
            <button className="icon-btn" onClick={reset} disabled={lines.length === 0} aria-label="Clear cart">
              <Icon name="trash" size={16} />
            </button>
          </div>
        </header>

        <div className="cart-customer">
          <Icon name="user" size={16} />
          <input
            list="pos-customers"
            placeholder={t('pos.customer')}
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            aria-label={t('pos.customer')}
          />
          <datalist id="pos-customers">
            {customers.map((c) => <option key={c.id} value={c.name} />)}
          </datalist>
          {customer && (
            <button className="icon-btn" onClick={() => setCustomer('')} aria-label="Clear customer">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        <div className="cart-lines">
          {lines.length === 0 ? (
            <div className="cart-empty">
              <span className="cart-empty-art"><Icon name="cart" size={26} /></span>
              <strong>Cart is empty</strong>
              <p>{t('pos.tapToAdd')}</p>
            </div>
          ) : (
            lines.map(({ p, qty }) => (
              <div className="cart-line" key={p.id}>
                <span className="cl-art" style={{ '--h': hueFor(p.name) } as CSSProperties}>{p.name.slice(0, 2).toUpperCase()}</span>
                <span className="cl-main">
                  <strong>{p.name}</strong>
                  <span className="muted small">
                    {formatMoney(p.price)} each
                    {p.trackSerials && ` · ${(cartSerials[p.id] ?? []).length} serial${(cartSerials[p.id] ?? []).length === 1 ? '' : 's'}`}
                  </span>
                </span>
                <span className="qty">
                  <button onClick={() => add(p.id, -1)} aria-label={`Less ${p.name}`}><Icon name="minus" size={13} /></button>
                  <span>{qty}</span>
                  <button onClick={() => add(p.id, 1)} aria-label={`More ${p.name}`}><Icon name="plus" size={13} /></button>
                </span>
                <span className="line-total">{formatMoney(qty * p.price)}</span>
                <button className="icon-btn line-remove" onClick={() => removeLine(p.id)} aria-label={`Remove ${p.name}`}>
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="cart-summary">
          <div className="sum-row"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>
          <div className="sum-row discount-row">
            <span>Discount</span>
            {discountMode === 'none' ? (
              <button className="link-btn" onClick={() => setDiscountMode('percent')} disabled={lines.length === 0}>Add discount</button>
            ) : (
              <span className="discount-entry">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  aria-label="Discount"
                />
                <button className={`mini-toggle ${discountMode === 'percent' ? 'active' : ''}`} onClick={() => setDiscountMode('percent')}>%</button>
                <button className={`mini-toggle ${discountMode === 'amount' ? 'active' : ''}`} onClick={() => setDiscountMode('amount')}>{config.currencySymbol}</button>
                <button className="icon-btn" onClick={() => { setDiscountMode('none'); setDiscountValue(''); }} aria-label="Remove discount"><Icon name="close" size={12} /></button>
              </span>
            )}
          </div>
          {discount > 0 && <div className="sum-row discount-total"><span>You save</span><span>−{formatMoney(discount)}</span></div>}
          {tax > 0 && (
            <div className="sum-row tax-row">
              <span>Tax {totals.breakdown.map((b) => `${b.name} ${b.rate}%`).join(', ')}</span>
              <span>{formatMoney(tax)}</span>
            </div>
          )}
          {currencies.length > 0 && (
            <div className="sum-row currency-row">
              <span>Currency</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Transaction currency">
                <option value="">{config.currencySymbol} base</option>
                {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} @ {c.rate}</option>)}
              </select>
            </div>
          )}
          <div className="sum-row total"><span>{t('pos.total')}</span><strong>{formatMoney(total)}</strong></div>
          {selectedCurrency && <div className="sum-row foreign-total"><span>{selectedCurrency.code}</span><span>{selectedCurrency.symbol}{foreignTotal.toLocaleString(config.locale, { maximumFractionDigits: 2 })}</span></div>}
        </div>

        <div className="pay-methods" role="group" aria-label="Payment method">
          {PAYMENTS.map((m) => (
            <button key={m.id} className={`pay-method ${payment === m.id ? 'active' : ''}`} onClick={() => setPayment(m.id)}>
              <Icon name={m.icon} size={16} />
              {m.label}
            </button>
          ))}
        </div>

        <div className="split-bar">
          <button
            type="button"
            className={`link-btn ${split ? 'active' : ''}`}
            onClick={() => {
              const next = !split;
              setSplit(next);
              if (next) setTenders([{ method: payment, amount: String(total) }, { method: payment === 'cash' ? 'transfer' : 'cash', amount: '' }]);
            }}
          >
            <Icon name="creditCard" size={14} /> {split ? 'Cancel split payment' : 'Split payment'}
          </button>
        </div>

        {!split && payment === 'cash' && (
          <div className="cash-row">
            <label>
              <span>Cash received</span>
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder={formatMoney(total)}
                value={cashReceived}
                onChange={(e) => setCashReceived(e.target.value)}
              />
            </label>
            <div className={`change ${cashReceived === '' ? '' : change < 0 ? 'neg' : ''}`}>
              <span>Change</span>
              <strong>{cashReceived === '' ? '—' : formatMoney(Math.max(0, change))}</strong>
            </div>
          </div>
        )}

        {split && (
          <div className="tenders">
            {tenders.map((tender, i) => (
              <div className="tender-row" key={i}>
                <select
                  value={tender.method}
                  onChange={(e) => setTenders(tenders.map((x, n) => (n === i ? { ...x, method: e.target.value } : x)))}
                  aria-label={`Tender ${i + 1} method`}
                >
                  {PAYMENTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={tender.amount}
                  onChange={(e) => setTenders(tenders.map((x, n) => (n === i ? { ...x, amount: e.target.value } : x)))}
                  aria-label={`Tender ${i + 1} amount`}
                />
                <button type="button" className="icon-btn" onClick={() => setTenders(tenders.filter((_, n) => n !== i))} disabled={tenders.length <= 2} aria-label="Remove tender">
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
            <div className="tender-foot">
              <button type="button" className="link-btn" onClick={() => setTenders([...tenders, { method: 'cash', amount: '' }])}>+ Add tender</button>
              <span className={`tender-sum ${Math.abs(tenderTotal - total) > 0.005 ? 'neg' : 'ok'}`}>
                {formatMoney(tenderTotal)} / {formatMoney(total)}
              </span>
            </div>
          </div>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}

        <button ref={payRef} className={`btn btn-primary charge-btn ${busy ? 'loading' : ''}`} disabled={lines.length === 0 || busy || (split && Math.abs(tenderTotal - total) > 0.005)} onClick={() => void pay()}>
          {busy ? 'Saving…' : <>{t('pos.charge', { amount: formatMoney(total) })} <span className="kbd kbd-invert">F4</span></>}
        </button>
        {lines.length > 0 && (
          <button className="link-btn center-link" onClick={reset}>{t('pos.clear')}</button>
        )}
      </aside>

      {receipt && <Receipt sale={receipt} autoPrint onClose={() => setReceipt(null)} />}

      {pickerProduct && (
        <div className="modal-backdrop" onClick={() => setPickerId(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Choose serial numbers">
            <header className="modal-header">
              <div><h3>Choose serial numbers</h3><p className="panel-sub">{pickerProduct.name} · {(cartSerials[pickerProduct.id] ?? []).length} already in cart</p></div>
              <button className="icon-btn" onClick={() => setPickerId(null)} aria-label="Close"><Icon name="close" size={16} /></button>
            </header>
            <div className="modal-body">
              {serialOptions.filter((s) => !(cartSerials[pickerProduct.id] ?? []).includes(s.id)).length === 0 ? (
                <div className="empty-state compact">
                  <p>No available serial numbers for this product in this branch.</p>
                  <p className="muted small">Register serials in Advanced → Serial numbers, or receive them with the product.</p>
                </div>
              ) : (
                <ul className="serial-picker-list">
                  {serialOptions.filter((s) => !(cartSerials[pickerProduct.id] ?? []).includes(s.id)).map((s) => (
                    <li key={s.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={pickerSelected.includes(s.id)}
                          onChange={(e) => setPickerSelected(e.target.checked ? [...pickerSelected, s.id] : pickerSelected.filter((x) => x !== s.id))}
                        />
                        <span className="serial-main"><strong>{s.serial}</strong><small>{s.batchNo ? `Batch ${s.batchNo} · ` : ''}{s.warrantyUntil ? `Warranty to ${new Date(s.warrantyUntil).toLocaleDateString()}` : 'No warranty'}</small></span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <footer className="modal-footer">
              <span className="muted small">{pickerSelected.length} selected</span>
              <button className="btn btn-ghost" onClick={() => setPickerId(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={pickerSelected.length === 0} onClick={confirmSerials}>Add {pickerSelected.length || ''} to cart</button>
            </footer>
          </div>
        </div>
      )}

      {scannerOpen && (
        <BarcodeScanner
          onScan={(code) => {
            const needle = code.trim().toLowerCase();
            const hit = products.find((p) => p.sku.toLowerCase() === needle) ?? products.find((p) => p.aliases.some((a) => a.toLowerCase() === needle));
            if (hit) add(hit.id);
            else setError(`No product matches barcode "${code}".`);
          }}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {lines.length > 0 && !cartVisible && (
        <button className="mobile-cart-cta" onClick={() => cartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <span><Icon name="cart" size={16} /> {itemCount} item{itemCount === 1 ? '' : 's'}</span>
          <strong>View cart · {formatMoney(total)}</strong>
          <Icon name="arrowDown" size={15} />
        </button>
      )}

      {heldOpen && (
        <div className="modal-backdrop" onClick={() => setHeldOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Held sales">
            <header className="modal-header">
              <h3>Held sales</h3>
              <button className="icon-btn" onClick={() => setHeldOpen(false)} aria-label="Close"><Icon name="close" size={16} /></button>
            </header>
            <div className="modal-body">
              {held.length === 0 ? (
                <div className="empty-state compact"><p>No held sales. Use Hold to park a cart and serve the next customer.</p></div>
              ) : (
                <ul className="held-list">
                  {held.map((h) => {
                    const count = Object.values(h.cart).reduce((s, n) => s + n, 0);
                    return (
                      <li key={h.id}>
                        <span className="held-main">
                          <strong>{h.customer || 'Walk-in'}</strong>
                          <small>{count} item{count === 1 ? '' : 's'} · {new Date(h.at).toLocaleTimeString()}</small>
                        </span>
                        <button className="btn btn-sm" onClick={() => resume(h)}>Resume</button>
                        <button className="icon-btn" onClick={() => removeHeld(h.id)} aria-label="Discard held sale"><Icon name="trash" size={14} /></button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
