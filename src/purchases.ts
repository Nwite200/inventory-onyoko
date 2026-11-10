// Suppliers and purchases (goods received). Receiving a purchase adds stock to THIS shop,
// records what was paid per unit (it becomes the product's cost) and what is still owed.
import { db, uid, type Purchase, type Supplier } from './db';
import { queue } from './actions';
import { currentLocationId } from './location';
import { makeNumber, numberPrefix, startOfDay } from './numbering';
import { recordMovement } from './stock';

export async function addSupplier(name: string, phone = ''): Promise<Supplier> {
  const n = name.trim();
  if (!n) throw new Error('Supplier name is required');
  const existing = (await db.suppliers.toArray()).find((s) => s.name.toLowerCase() === n.toLowerCase());
  if (existing) return existing;
  const s: Supplier = { id: uid(), name: n, ...(phone.trim() ? { phone: phone.trim() } : {}) };
  await db.transaction('rw', db.suppliers, db.outbox, async () => {
    await db.suppliers.add(s);
    await queue('supplier', 'create', s);
  });
  return s;
}

export interface ReceiveInput {
  /** Existing supplier id, or leave empty and give supplierName to create one on the spot. */
  supplierId?: string;
  supplierName?: string;
  items: { productId: string; qty: number; cost: number }[];
  /** Money paid to the supplier now. Anything unpaid stays as "owed". */
  paid?: number;
  note?: string;
}

export async function receivePurchase(input: ReceiveInput): Promise<Purchase> {
  if (input.items.length === 0) throw new Error('Add at least one product');
  for (const it of input.items) {
    if (!(it.qty > 0)) throw new Error('Quantity must be more than zero');
    if (!(it.cost >= 0)) throw new Error('Cost must be zero or more');
  }
  const supplier = input.supplierId ? await db.suppliers.get(input.supplierId) : input.supplierName?.trim() ? await addSupplier(input.supplierName) : undefined;
  if (!supplier) throw new Error('Choose a supplier');

  return db.transaction('rw', [db.products, db.stockMovements, db.suppliers, db.purchases, db.outbox], async () => {
    const lines = [];
    for (const it of input.items) {
      const p = await db.products.get(it.productId);
      if (!p) throw new Error('A product in this purchase no longer exists');
      lines.push({ productId: p.id, name: p.name, qty: it.qty, cost: it.cost });
    }
    const total = lines.reduce((s, l) => s + l.qty * l.cost, 0);
    const paid = Math.min(Math.max(input.paid ?? 0, 0), total);
    const at = Date.now();
    const prefix = numberPrefix('PO', at);
    const made = await db.purchases.where('at').aboveOrEqual(startOfDay(at)).filter((x) => x.number.startsWith(prefix)).count();
    const purchase: Purchase = {
      id: uid(),
      number: makeNumber('PO', at, made),
      at,
      supplierId: supplier.id,
      supplierName: supplier.name,
      items: lines,
      total,
      paid,
      payments: paid > 0 ? [{ id: uid(), amount: paid, at }] : [],
      status: 'received',
      locationId: currentLocationId(),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    };
    await db.purchases.add(purchase);
    for (const l of lines) {
      await recordMovement({ id: `${purchase.id}:${l.productId}:purchase`, productId: l.productId, delta: l.qty, reason: 'purchase', ref: purchase.id, at, locationId: purchase.locationId });
      const p = (await db.products.get(l.productId))!;
      await db.products.put({ ...p, cost: l.cost, costAt: at });
    }
    await queue('purchase', 'create', purchase);
    return purchase;
  });
}

/** Cancels a purchase: the goods go back out of stock (at the shop that received them). */
export async function voidPurchase(purchaseId: string): Promise<void> {
  await db.transaction('rw', [db.products, db.stockMovements, db.purchases, db.outbox], async () => {
    const pur = await db.purchases.get(purchaseId);
    if (!pur) throw new Error('Purchase not found');
    if (pur.status === 'voided') throw new Error('Purchase is already cancelled');
    const at = Date.now();
    for (const l of pur.items) {
      await recordMovement({ id: `${pur.id}:${l.productId}:purchase_void`, productId: l.productId, delta: -l.qty, reason: 'purchase_void', ref: pur.id, at, locationId: pur.locationId });
    }
    await db.purchases.put({ ...pur, status: 'voided' });
    // the event carries what is needed to undo the stock, and no prices
    await queue('purchase', 'void', { id: pur.id, locationId: pur.locationId, items: pur.items.map((l) => ({ productId: l.productId, qty: l.qty })) });
  });
}

/** Records a payment to the supplier for an earlier purchase. */
export async function payPurchase(purchaseId: string, amount: number): Promise<Purchase> {
  if (!(amount > 0)) throw new Error('Amount must be more than zero');
  return db.transaction('rw', db.purchases, db.outbox, async () => {
    const pur = await db.purchases.get(purchaseId);
    if (!pur) throw new Error('Purchase not found');
    if (pur.status === 'voided') throw new Error('This purchase was cancelled');
    if (amount > pur.total - pur.paid + 0.0001) throw new Error(`Only ${pur.total - pur.paid} is still owed`);
    const at = Date.now();
    const payment = { id: uid(), amount, at };
    const updated = { ...pur, paid: pur.paid + amount, payments: [...pur.payments, payment] };
    await db.purchases.put(updated);
    await queue('purchase', 'pay', { id: pur.id, paymentId: payment.id, amount });
    return updated;
  });
}

export interface SupplierBalance {
  supplier: Supplier;
  bought: number;
  paid: number;
  owed: number;
}

/** What the shop has bought from each supplier and still owes them (cancelled purchases excluded). */
export async function supplierBalances(): Promise<SupplierBalance[]> {
  const [suppliers, purchases] = await Promise.all([db.suppliers.toArray(), db.purchases.toArray()]);
  return suppliers
    .map((supplier) => {
      const mine = purchases.filter((p) => p.supplierId === supplier.id && p.status === 'received');
      const bought = mine.reduce((s, p) => s + p.total, 0);
      const paid = mine.reduce((s, p) => s + p.paid, 0);
      return { supplier, bought, paid, owed: bought - paid };
    })
    .sort((a, b) => b.owed - a.owed || a.supplier.name.localeCompare(b.supplier.name));
}
