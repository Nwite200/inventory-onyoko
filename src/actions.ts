// Every state change in the app (screens AND voice) goes through these functions,
// so there is exactly one code path: write to IndexedDB, then queue for sync.
import { db, uid, type AuditEntry, type Product, type Sale, type SaleItem } from './db';
import { config } from './config';
import { currentLocationId } from './location';
import { canEncode } from './printing/code128';
import { makeNumber, numberPrefix } from './numbering';
import { recordMovement } from './stock';
import { computeSaleTotals } from './tax';
import { requireApproval } from './approvals';

export async function queue(entity: string, op: string, payload: unknown): Promise<void> {
  await db.outbox.add({ entity, op, payload, at: Date.now() });
}

export interface NewProduct {
  name: string;
  price: number;
  cost?: number;
  sku?: string;
  unit?: string;
  aliases?: string[];
  openingStock?: number;
  lowStockAt?: number;
  category?: string;
  taxRateId?: string;
  trackSerials?: boolean;
}

export async function addProduct(input: NewProduct): Promise<Product> {
  const name = input.name.trim();
  if (!name) throw new Error('Product name is required');
  if (!(input.price >= 0)) throw new Error('Price must be zero or more');
  const product: Product = {
    id: uid(),
    name,
    sku: (input.sku ?? '').trim(),
    aliases: (input.aliases ?? []).map((a) => a.trim()).filter(Boolean),
    price: input.price,
    cost: input.cost ?? 0,
    unit: (input.unit ?? 'pcs').trim() || 'pcs',
    stock: 0, // opening stock is a movement (below), so every shop counts it correctly
    lowStockAt: input.lowStockAt ?? 5,
    ...(input.category?.trim() ? { category: input.category.trim() } : {}),
    ...(input.taxRateId ? { taxRateId: input.taxRateId } : {}),
    ...(input.trackSerials ? { trackSerials: true } : {}),
    updatedAt: Date.now(),
    priceAt: Date.now(),
  };
  await db.transaction('rw', db.products, db.stockMovements, db.outbox, async () => {
    const opening = input.openingStock ?? 0;
    await db.products.add(product);
    await queue('product', 'create', product);
    if (opening !== 0) {
      const m = { id: `${product.id}:opening`, productId: product.id, delta: opening, reason: 'opening', at: Date.now(), locationId: currentLocationId() };
      await recordMovement(m);
      await queue('stock_movement', 'create', m);
    }
  });
  return (await db.products.get(product.id))!;
}

export async function setPrice(productId: string, price: number): Promise<Product> {
  if (!(price >= 0)) throw new Error('Price must be zero or more');
  return db.transaction('rw', db.products, db.outbox, async () => {
    const p = await db.products.get(productId);
    if (!p) throw new Error('Product not found');
    const at = Date.now();
    const updated = { ...p, price, updatedAt: at, priceAt: at };
    await db.products.put(updated);
    await queue('product', 'update', { id: p.id, price, at });
    return updated;
  });
}

/** Sets (or clears, with '') a product's barcode / SKU. Codes must be unique among products. */
export async function setSku(productId: string, sku: string): Promise<Product> {
  const code = sku.trim();
  if (code && !canEncode(code)) throw new Error('A barcode can only contain letters, digits and common symbols (no accents), up to 80 characters.');
  return db.transaction('rw', db.products, db.outbox, async () => {
    const p = await db.products.get(productId);
    if (!p) throw new Error('Product not found');
    if (code && (await db.products.where('sku').equals(code).filter((x) => x.id !== productId).count()) > 0) {
      throw new Error('Another product already uses that barcode');
    }
    const at = Date.now();
    const updated = { ...p, sku: code, skuAt: at, updatedAt: at };
    await db.products.put(updated);
    await queue('product', 'update', { id: p.id, sku: code, at });
    return updated;
  });
}

/** Gives every product that has no barcode a new unique number (9 digits, starting with 2). Returns how many. */
export async function assignMissingSkus(): Promise<number> {
  const all = await db.products.toArray();
  const used = new Set(all.map((p) => p.sku).filter(Boolean));
  let n = 0;
  for (const p of all.filter((x) => !x.sku)) {
    let code = '';
    do {
      const r = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! % 100_000_000;
      code = '2' + String(r).padStart(8, '0');
    } while (used.has(code));
    used.add(code);
    await setSku(p.id, code);
    n++;
  }
  return n;
}

export async function deleteProduct(productId: string): Promise<void> {
  await db.transaction('rw', db.products, db.outbox, async () => {
    await db.products.delete(productId);
    await queue('product', 'delete', { id: productId });
  });
}

/** Stock is event-based: every change is a movement row, never an overwrite. */
export async function adjustStock(productId: string, delta: number, reason = 'adjustment', ref?: string, approvalKey?: string): Promise<Product> {
  if (!Number.isFinite(delta) || delta === 0) throw new Error('Quantity must be a non-zero number');
  const product = await db.products.get(productId);
  if (!product) throw new Error('Product not found');
  const value = Math.round(Math.abs(delta) * product.cost * 100) / 100;
  const key = approvalKey ?? `adjust:${productId}:${delta}:${Math.floor(Date.now() / 60_000)}`;
  await requireApproval('stock_adjustment', key, value);
  return db.transaction('rw', db.products, db.stockMovements, db.outbox, async () => {
    const p = await db.products.get(productId);
    if (!p) throw new Error('Product not found');
    const next = p.stock + delta;
    if (next < 0 && !config.allowNegativeStock) {
      throw new Error(`Only ${p.stock} ${p.name} in stock`);
    }
    const movement = { id: uid(), productId, delta, reason, ref, at: Date.now(), locationId: currentLocationId(), value, approvalKey: key };
    await recordMovement(movement);
    await queue('stock_movement', 'create', movement);
    return (await db.products.get(productId))!;
  });
}

export interface CheckoutInput {
  items: { productId: string; qty: number; price?: number; taxRateId?: string; serials?: string[] }[];
  customerName?: string;
  payment?: string;
  /** Absolute discount applied to the subtotal. */
  discount?: number;
  /** Split tenders. Their sum must equal the sale total. */
  payments?: { method: string; amount: number; reference?: string }[];
  cashier?: string;
  note?: string;
  /** Foreign currency details; the stored total always remains in base currency. */
  currency?: string;
  fxRate?: number;
  documentId?: string;
}

export async function checkout(input: CheckoutInput): Promise<Sale> {
  if (input.items.length === 0) throw new Error('Cart is empty');
  return db.transaction('rw', [db.products, db.stockMovements, db.sales, db.customers, db.taxRates, db.serials, db.bins, db.binMovements, db.outbox], async () => {
    const saleId = uid();
    const lines: SaleItem[] = [];
    // merge duplicate product lines so stock checks are accurate
    const merged = new Map<string, { qty: number; price?: number; taxRateId?: string; serials: string[] }>();
    for (const it of input.items) {
      if (!(it.qty > 0)) throw new Error('Quantity must be more than zero');
      const prev = merged.get(it.productId);
      merged.set(it.productId, {
        qty: (prev?.qty ?? 0) + it.qty,
        price: it.price ?? prev?.price,
        taxRateId: it.taxRateId ?? prev?.taxRateId,
        serials: [...(prev?.serials ?? []), ...(it.serials ?? [])],
      });
    }
    const here = currentLocationId();
    const binStock = new Map<string, Map<string, number>>();
    for (const m of await db.binMovements.toArray()) {
      if (m.locationId !== here) continue;
      const per = binStock.get(m.binId) ?? new Map<string, number>();
      per.set(m.productId, (per.get(m.productId) ?? 0) + m.delta);
      binStock.set(m.binId, per);
    }
    const binCodes = new Map((await db.bins.toArray()).filter((b) => b.locationId === here).map((b) => [b.id, b.code]));
    for (const [productId, spec] of merged) {
      const p = await db.products.get(productId);
      if (!p) throw new Error('A product in the cart no longer exists');
      if (p.stock - spec.qty < 0 && !config.allowNegativeStock) {
        throw new Error(`Only ${p.stock} ${p.name} in stock`);
      }
      if (spec.price !== undefined && !(spec.price >= 0)) throw new Error('Price must be zero or more');
      let binPicks: { binId: string; qty: number }[] = [];
      let binned = 0;
      for (const per of binStock.values()) binned += per.get(productId) ?? 0;
      if (binned > 0) {
        if (binned + 0.0001 < spec.qty) throw new Error(`Only ${binned} ${p.name} is in bins. Put away more stock, release a stale bin, or sell unassigned stock first.`);
        let left = spec.qty;
        const bins = [...binStock.entries()].filter(([, per]) => (per.get(productId) ?? 0) > 0).sort((a, b) => (binCodes.get(a[0]) ?? a[0]).localeCompare(binCodes.get(b[0]) ?? b[0]));
        for (const [binId, per] of bins) {
          if (left <= 0) break;
          const take = Math.min(left, per.get(productId) ?? 0);
          if (take > 0) binPicks.push({ binId, qty: take });
          left -= take;
        }
      }
      const serials: string[] = [];
      if (p.trackSerials) {
        const chosen = [...new Set(spec.serials)];
        if (chosen.length !== spec.qty) throw new Error(`Choose ${spec.qty} serial number${spec.qty === 1 ? '' : 's'} for ${p.name}`);
        for (const serialId of chosen) {
          const serial = await db.serials.get(serialId);
          if (!serial || serial.productId !== productId) throw new Error(`Serial ${serialId} does not belong to ${p.name}`);
          if (serial.status !== 'in_stock') throw new Error(`Serial ${serial.serial} is not available`);
          if ((serial.locationId ?? 'main') !== here) throw new Error(`Serial ${serial.serial} is in another branch`);
          serials.push(serialId);
        }
      }
      // cost is captured now so historical profit does not move when the cost price changes
      lines.push({
        productId, name: p.name, qty: spec.qty, price: spec.price ?? p.price, cost: p.cost,
        ...(spec.taxRateId ?? p.taxRateId ? { taxRateId: spec.taxRateId ?? p.taxRateId } : {}),
        ...(serials.length ? { serials } : {}),
        ...(binPicks.length ? { binPicks } : {}),
      });
      for (const serialId of serials) {
        const serial = (await db.serials.get(serialId))!;
        const next = { ...serial, status: 'sold' as const, saleId, updatedAt: Date.now() };
        await db.serials.put(next);
      }
    }
    const now = Date.now();
    const prefix = numberPrefix('INV', now);
    const number = makeNumber('INV', now, await db.sales.where('at').aboveOrEqual(startOfDay(now)).filter((s) => s.number.startsWith(prefix)).count());
    const requested = Number(input.discount ?? 0);
    if (!Number.isFinite(requested) || requested < 0) throw new Error('Discount must be zero or more');
    const taxRates = await db.taxRates.toArray();
    const totals = computeSaleTotals(lines.map((l) => ({ productId: l.productId, qty: l.qty, price: l.price, taxRateId: l.taxRateId })), requested, taxRates);
    const customerName = (input.customerName ?? '').trim();
    if (customerName) {
      const existing = (await db.customers.toArray()).find((c) => c.name.toLowerCase() === customerName.toLowerCase());
      if (!existing) {
        const c = { id: uid(), name: customerName };
        await db.customers.add(c);
        await queue('customer', 'create', c);
      }
    }
    let payments = input.payments?.filter((p) => p.amount > 0).map((p) => ({ method: p.method, amount: Math.round(p.amount * 100) / 100, ...(p.reference?.trim() ? { reference: p.reference.trim() } : {}) }));
    if (payments && payments.length > 0) {
      const paid = Math.round(payments.reduce((s, p) => s + p.amount, 0) * 100) / 100;
      if (Math.abs(paid - totals.total) > 0.005) throw new Error(`Payments (${paid}) must add up to the total (${totals.total})`);
    } else {
      payments = undefined;
    }
    const primaryPayment = payments && payments.length > 1 ? 'split' : payments?.[0]?.method ?? input.payment ?? 'cash';
    if (!(Number(input.fxRate) > 0) && input.currency) throw new Error('A currency needs a valid exchange rate');
    const sale: Sale = {
      id: saleId,
      number,
      at: Date.now(),
      customerName: customerName || 'Walk-in',
      payment: primaryPayment,
      items: lines,
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      ...(totals.breakdown.length ? { taxBreakdown: totals.breakdown } : {}),
      ...(payments ? { payments } : {}),
      total: totals.total,
      status: 'completed',
      locationId: currentLocationId(),
      ...(input.cashier ? { cashier: input.cashier } : {}),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      ...(input.currency && input.fxRate ? { currency: input.currency, fxRate: input.fxRate, foreignTotal: Math.round((totals.total / input.fxRate) * 100) / 100 } : {}),
      ...(input.documentId ? { documentId: input.documentId } : {}),
    };
    await db.sales.add(sale);
    for (const l of lines) {
      // fixed ids: the same sale applied twice (or on another device) can never count twice
      await recordMovement({ id: `${saleId}:${l.productId}:sale`, productId: l.productId, delta: -l.qty, reason: 'sale', ref: saleId, at: sale.at, locationId: sale.locationId });
      for (const pick of l.binPicks ?? []) {
        await db.binMovements.add({
          id: `${saleId}:${l.productId}:${pick.binId}:bin`,
          productId: l.productId,
          binId: pick.binId,
          delta: -pick.qty,
          reason: 'sale_pick',
          ref: saleId,
          at: sale.at,
          locationId: sale.locationId ?? currentLocationId(),
        });
      }
    }
    await queue('sale', 'create', sale);
    return sale;
  });
}

export async function voidSale(saleId: string): Promise<void> {
  const existing = await db.sales.get(saleId);
  if (!existing) throw new Error('Sale not found');
  if (existing.status === 'voided') throw new Error('Sale is already voided');
  const approval = await requireApproval('void', saleId, existing.total);
  await db.transaction('rw', [db.products, db.stockMovements, db.sales, db.serials, db.binMovements, db.outbox], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) throw new Error('Sale not found');
    if (sale.status === 'voided') throw new Error('Sale is already voided');
    for (const l of sale.items) {
      if (!(await db.products.get(l.productId))) continue; // product was deleted; nothing to restock
      await recordMovement({ id: `${saleId}:${l.productId}:void`, productId: l.productId, delta: l.qty, reason: 'void', ref: saleId, at: Date.now(), locationId: sale.locationId });
      for (const serialId of l.serials ?? []) {
        const serial = await db.serials.get(serialId);
        if (serial) await db.serials.put({ ...serial, status: 'in_stock', saleId: undefined, updatedAt: Date.now() });
      }
      for (const pick of l.binPicks ?? []) {
        await db.binMovements.add({
          id: `${saleId}:${l.productId}:${pick.binId}:voidbin`,
          productId: l.productId,
          binId: pick.binId,
          delta: pick.qty,
          reason: 'sale_void',
          ref: saleId,
          at: Date.now(),
          locationId: sale.locationId ?? currentLocationId(),
        });
      }
    }
    await db.sales.put({ ...sale, status: 'voided' });
    await queue('sale', 'void', { id: saleId, ...(approval ? { approvalId: approval.id } : {}) });
  });
}

export function startOfDay(ts = Date.now()): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface SalesSummary {
  count: number;
  total: number;
  top: { name: string; qty: number }[];
}

/** shop: 'this' = only sales made at this device's shop; 'all' = every shop. */
export async function salesSummary(since: number, shop: 'this' | 'all' = 'this'): Promise<SalesSummary> {
  const here = currentLocationId();
  const sales = (await db.sales.where('at').aboveOrEqual(since).toArray()).filter(
    (s) => s.status === 'completed' && (shop === 'all' || (s.locationId ?? 'main') === here),
  );
  const byProduct = new Map<string, number>();
  for (const s of sales) for (const l of s.items) byProduct.set(l.name, (byProduct.get(l.name) ?? 0) + l.qty);
  const top = [...byProduct.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 5);
  return { count: sales.length, total: sales.reduce((s, x) => s + x.total, 0), top };
}

export async function lowStock(): Promise<Product[]> {
  return (await db.products.toArray()).filter((p) => p.stock <= p.lowStockAt).sort((a, b) => a.stock - b.stock);
}

export async function logAudit(entry: Omit<AuditEntry, 'id' | 'at'>): Promise<void> {
  await db.audit.add({ ...entry, at: Date.now() });
}

export async function seedDemo(): Promise<void> {
  if ((await db.products.count()) > 0) return;
  const items: NewProduct[] = [
    { name: 'Rice 50kg Bag', sku: '1001', price: 45000, cost: 40000, unit: 'bag', aliases: ['rice', 'bag of rice'], openingStock: 20, lowStockAt: 5, category: 'Grains' },
    { name: 'Indomie Noodles Carton', sku: '1002', price: 7500, cost: 6800, unit: 'carton', aliases: ['indomie', 'noodles'], openingStock: 40, lowStockAt: 10, category: 'Packaged food' },
    { name: 'Coke Bottle 50cl', sku: '1003', price: 300, cost: 220, unit: 'bottle', aliases: ['coke', 'coca cola'], openingStock: 120, lowStockAt: 24, category: 'Drinks' },
    { name: 'Fanta Bottle 50cl', sku: '1004', price: 300, cost: 220, unit: 'bottle', aliases: ['fanta'], openingStock: 80, lowStockAt: 24, category: 'Drinks' },
    { name: 'Sugar 1kg', sku: '1005', price: 1800, cost: 1500, unit: 'pack', aliases: ['sugar'], openingStock: 30, lowStockAt: 8, category: 'Packaged food' },
    { name: 'Vegetable Oil 5L', sku: '1006', price: 9500, cost: 8700, unit: 'bottle', aliases: ['oil', 'groundnut oil', 'vegetable oil'], openingStock: 12, lowStockAt: 4, category: 'Cooking' },
    { name: 'Spaghetti Pack', sku: '1007', price: 900, cost: 750, unit: 'pack', aliases: ['spaghetti', 'pasta'], openingStock: 3, lowStockAt: 10, category: 'Packaged food' },
  ];
  for (const i of items) await addProduct(i);
  for (const name of ['Mama Ade', 'Chinedu Okafor']) {
    const c = { id: uid(), name };
    await db.customers.add(c);
    await queue('customer', 'create', c); // queued so other devices get them too
  }
}
