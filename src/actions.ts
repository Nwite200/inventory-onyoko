// Every state change in the app (screens AND voice) goes through these functions,
// so there is exactly one code path: write to IndexedDB, then queue for sync.
import { db, uid, type AuditEntry, type Product, type Sale, type SaleItem } from './db';
import { config } from './config';
import { currentLocationId } from './location';
import { makeNumber, numberPrefix } from './numbering';
import { recordMovement } from './stock';

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

export async function deleteProduct(productId: string): Promise<void> {
  await db.transaction('rw', db.products, db.outbox, async () => {
    await db.products.delete(productId);
    await queue('product', 'delete', { id: productId });
  });
}

/** Stock is event-based: every change is a movement row, never an overwrite. */
export async function adjustStock(productId: string, delta: number, reason = 'adjustment', ref?: string): Promise<Product> {
  if (!Number.isFinite(delta) || delta === 0) throw new Error('Quantity must be a non-zero number');
  return db.transaction('rw', db.products, db.stockMovements, db.outbox, async () => {
    const p = await db.products.get(productId);
    if (!p) throw new Error('Product not found');
    const next = p.stock + delta;
    if (next < 0 && !config.allowNegativeStock) {
      throw new Error(`Only ${p.stock} ${p.name} in stock`);
    }
    const movement = { id: uid(), productId, delta, reason, ref, at: Date.now(), locationId: currentLocationId() };
    await recordMovement(movement);
    await queue('stock_movement', 'create', movement);
    return (await db.products.get(productId))!;
  });
}

export interface CheckoutInput {
  items: { productId: string; qty: number }[];
  customerName?: string;
  payment?: string;
}

export async function checkout(input: CheckoutInput): Promise<Sale> {
  if (input.items.length === 0) throw new Error('Cart is empty');
  return db.transaction('rw', db.products, db.stockMovements, db.sales, db.customers, db.outbox, async () => {
    const saleId = uid();
    const lines: SaleItem[] = [];
    // merge duplicate product lines so stock checks are accurate
    const merged = new Map<string, number>();
    for (const it of input.items) {
      if (!(it.qty > 0)) throw new Error('Quantity must be more than zero');
      merged.set(it.productId, (merged.get(it.productId) ?? 0) + it.qty);
    }
    for (const [productId, qty] of merged) {
      const p = await db.products.get(productId);
      if (!p) throw new Error('A product in the cart no longer exists');
      if (p.stock - qty < 0 && !config.allowNegativeStock) {
        throw new Error(`Only ${p.stock} ${p.name} in stock`);
      }
      lines.push({ productId, name: p.name, qty, price: p.price });
    }
    const now = Date.now();
    const prefix = numberPrefix('INV', now);
    const number = makeNumber('INV', now, await db.sales.where('at').aboveOrEqual(startOfDay(now)).filter((s) => s.number.startsWith(prefix)).count());
    const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
    const customerName = (input.customerName ?? '').trim();
    if (customerName) {
      const existing = (await db.customers.toArray()).find((c) => c.name.toLowerCase() === customerName.toLowerCase());
      if (!existing) {
        const c = { id: uid(), name: customerName };
        await db.customers.add(c);
        await queue('customer', 'create', c);
      }
    }
    const sale: Sale = {
      id: saleId,
      number,
      at: Date.now(),
      customerName: customerName || 'Walk-in',
      payment: input.payment || 'cash',
      items: lines,
      total,
      status: 'completed',
      locationId: currentLocationId(),
    };
    await db.sales.add(sale);
    for (const l of lines) {
      // fixed ids: the same sale applied twice (or on another device) can never count twice
      await recordMovement({ id: `${saleId}:${l.productId}:sale`, productId: l.productId, delta: -l.qty, reason: 'sale', ref: saleId, at: sale.at, locationId: sale.locationId });
    }
    await queue('sale', 'create', sale);
    return sale;
  });
}

export async function voidSale(saleId: string): Promise<void> {
  await db.transaction('rw', db.products, db.stockMovements, db.sales, db.outbox, async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) throw new Error('Sale not found');
    if (sale.status === 'voided') throw new Error('Sale is already voided');
    for (const l of sale.items) {
      if (!(await db.products.get(l.productId))) continue; // product was deleted; nothing to restock
      await recordMovement({ id: `${saleId}:${l.productId}:void`, productId: l.productId, delta: l.qty, reason: 'void', ref: saleId, at: Date.now(), locationId: sale.locationId });
    }
    await db.sales.put({ ...sale, status: 'voided' });
    await queue('sale', 'void', { id: saleId });
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
    { name: 'Rice 50kg Bag', sku: '1001', price: 45000, cost: 40000, unit: 'bag', aliases: ['rice', 'bag of rice'], openingStock: 20, lowStockAt: 5 },
    { name: 'Indomie Noodles Carton', sku: '1002', price: 7500, cost: 6800, unit: 'carton', aliases: ['indomie', 'noodles'], openingStock: 40, lowStockAt: 10 },
    { name: 'Coke Bottle 50cl', sku: '1003', price: 300, cost: 220, unit: 'bottle', aliases: ['coke', 'coca cola'], openingStock: 120, lowStockAt: 24 },
    { name: 'Fanta Bottle 50cl', sku: '1004', price: 300, cost: 220, unit: 'bottle', aliases: ['fanta'], openingStock: 80, lowStockAt: 24 },
    { name: 'Sugar 1kg', sku: '1005', price: 1800, cost: 1500, unit: 'pack', aliases: ['sugar'], openingStock: 30, lowStockAt: 8 },
    { name: 'Vegetable Oil 5L', sku: '1006', price: 9500, cost: 8700, unit: 'bottle', aliases: ['oil', 'groundnut oil', 'vegetable oil'], openingStock: 12, lowStockAt: 4 },
    { name: 'Spaghetti Pack', sku: '1007', price: 900, cost: 750, unit: 'pack', aliases: ['spaghetti', 'pasta'], openingStock: 3, lowStockAt: 10 },
  ];
  for (const i of items) await addProduct(i);
  for (const name of ['Mama Ade', 'Chinedu Okafor']) {
    const c = { id: uid(), name };
    await db.customers.add(c);
    await queue('customer', 'create', c); // queued so other devices get them too
  }
}
