// Applies changes made on OTHER devices to this device's local database.
// Rules (so devices converge no matter the order or repeats):
//  - Stock is event-based: sales and stock movements add/subtract, they never overwrite a number.
//  - Records are keyed by client-generated ids, so applying the same change twice does nothing.
//  - Prices are last-write-wins, using the time the price was set (priceAt).
// These writes deliberately bypass the outbox, otherwise every change would bounce back to the server forever.
import { db, type Product, type Purchase, type Sale, type StockMovement, type Transfer } from './db';
import { MAIN_LOCATION } from './location';
import { recordMovement } from './stock';

export interface RemoteChange {
  seq: number;
  entity: string;
  op: string;
  payload: Record<string, any>;
  at: number;
}

async function applyOne(c: RemoteChange): Promise<void> {
  const p = c.payload;
  switch (`${c.entity}:${c.op}`) {
    case 'product:create': {
      const existing = await db.products.get(p.id);
      if (existing) {
        // a device that was a cashier's has no cost prices; when a manager signs in the cost comes back
        if (typeof p.cost === 'number' && p.cost > 0 && !existing.cost && !existing.costAt) await db.products.put({ ...existing, cost: p.cost });
      } else {
        // stock arrives as movements, so a product never carries another shop's number
        const product: Product = { ...(p as Product), cost: p.cost ?? 0, aliases: p.aliases ?? [], stock: 0 };
        await db.products.add(product);
        // data from before shops existed carried the opening stock inside the product itself
        if (Number(p.stock) > 0) await recordMovement({ id: `${p.id}:opening`, productId: p.id, delta: Number(p.stock), reason: 'opening', at: c.at, locationId: MAIN_LOCATION });
      }
      return;
    }
    case 'product:update': {
      const existing = await db.products.get(p.id);
      if (existing && c.at >= (existing.priceAt ?? 0)) {
        await db.products.put({ ...existing, price: p.price, priceAt: c.at, updatedAt: Date.now() });
      }
      return;
    }
    case 'product:delete':
      await db.products.delete(p.id);
      return;
    case 'stock_movement:create': {
      await recordMovement(p as StockMovement);
      return;
    }
    case 'sale:create': {
      if (await db.sales.get(p.id)) return;
      const sale = p as Sale;
      await db.sales.add(sale);
      for (const l of sale.items) {
        await recordMovement({ id: `${sale.id}:${l.productId}:sale`, productId: l.productId, delta: -l.qty, reason: 'sale', ref: sale.id, at: sale.at, locationId: sale.locationId });
      }
      return;
    }
    case 'sale:void': {
      const sale = await db.sales.get(p.id);
      if (!sale || sale.status === 'voided') return;
      for (const l of sale.items) {
        await recordMovement({ id: `${sale.id}:${l.productId}:void`, productId: l.productId, delta: l.qty, reason: 'void', ref: sale.id, at: c.at, locationId: sale.locationId });
      }
      await db.sales.put({ ...sale, status: 'voided' });
      return;
    }
    case 'location:create': {
      if (!(await db.locations.get(p.id)) && p.name) await db.locations.add({ id: p.id, name: String(p.name) });
      return;
    }
    case 'supplier:create': {
      if (!(await db.suppliers.get(p.id)) && p.name) await db.suppliers.add({ id: p.id, name: String(p.name), phone: p.phone });
      return;
    }
    case 'purchase:create': {
      // Stock goes up in the shop that received it. Cashier devices get a version without prices
      // (no number/total/cost): they apply the stock only and keep no purchase record.
      const items = (p.items ?? []) as { productId: string; name?: string; qty: number; cost?: number }[];
      for (const it of items) {
        await recordMovement({ id: `${p.id}:${it.productId}:purchase`, productId: it.productId, delta: it.qty, reason: 'purchase', ref: p.id, at: c.at, locationId: p.locationId });
        const prod = await db.products.get(it.productId);
        if (prod && typeof it.cost === 'number' && c.at >= (prod.costAt ?? 0)) await db.products.put({ ...prod, cost: it.cost, costAt: c.at });
      }
      if (p.number && !(await db.purchases.get(p.id))) await db.purchases.add(p as Purchase);
      return;
    }
    case 'purchase:void': {
      const items = (p.items ?? []) as { productId: string; qty: number }[];
      for (const it of items) {
        await recordMovement({ id: `${p.id}:${it.productId}:purchase_void`, productId: it.productId, delta: -it.qty, reason: 'purchase_void', ref: p.id, at: c.at, locationId: p.locationId });
      }
      const pur = await db.purchases.get(p.id);
      if (pur && pur.status !== 'voided') await db.purchases.put({ ...pur, status: 'voided' });
      return;
    }
    case 'purchase:pay': {
      const pur = await db.purchases.get(p.id);
      if (!pur || pur.payments.some((x) => x.id === p.paymentId)) return;
      await db.purchases.put({ ...pur, paid: pur.paid + p.amount, payments: [...pur.payments, { id: p.paymentId, amount: p.amount, at: c.at }] });
      return;
    }
    case 'transfer:create': {
      // the sending shop's stock goes down the moment it is sent
      const t = p as Transfer;
      for (const it of t.items) {
        await recordMovement({ id: `${t.id}:${it.productId}:out`, productId: it.productId, delta: -it.qty, reason: 'transfer_out', ref: t.id, at: t.sentAt, locationId: t.fromLocationId });
      }
      if (!(await db.transfers.get(t.id))) await db.transfers.add(t);
      return;
    }
    case 'transfer:receive': {
      // ...and the receiving shop's stock goes up only when it confirms the goods arrived
      const items = (p.items ?? []) as { productId: string; qty: number }[];
      for (const it of items) {
        await recordMovement({ id: `${p.id}:${it.productId}:in`, productId: it.productId, delta: it.qty, reason: 'transfer_in', ref: p.id, at: c.at, locationId: p.toLocationId });
      }
      const t = await db.transfers.get(p.id);
      if (t && t.status !== 'received') await db.transfers.put({ ...t, status: 'received', receivedAt: c.at });
      return;
    }
    case 'customer:create': {
      if (await db.customers.get(p.id)) return;
      // two devices may each create "Mama Ade"; keep one record per name
      const name = String(p.name ?? '').trim();
      const dupe = (await db.customers.toArray()).some((c) => c.name.toLowerCase() === name.toLowerCase());
      if (name && !dupe) await db.customers.add({ id: p.id, name });
      return;
    }
    default:
    // unknown change from a newer server version: skip rather than crash
  }
}

export async function applyChanges(changes: RemoteChange[]): Promise<void> {
  await db.transaction('rw', [db.products, db.stockMovements, db.sales, db.customers, db.locations, db.suppliers, db.purchases, db.transfers], async () => {
    for (const c of changes) await applyOne(c);
  });
}

/**
 * The server refused a change this device had already applied locally (for example a cashier's stock
 * adjustment). Take its effect back out so this device's numbers match everyone else's.
 * These writes stay local: they are never queued, because the server never accepted the original.
 */
export async function undoRefused(entity: string, op: string, payload: Record<string, any>): Promise<void> {
  const key = `${entity}:${op}`;
  await db.transaction('rw', [db.products, db.stockMovements, db.sales, db.locations, db.suppliers, db.purchases, db.transfers], async () => {
    const reverse = async (items: { productId: string; qty: number }[], sign: 1 | -1, loc: string, ref: string, tag: string, reason: string) => {
      for (const it of items) {
        await recordMovement({ id: `${ref}:${it.productId}:${tag}`, productId: it.productId, delta: sign * it.qty, reason, ref, at: Date.now(), locationId: loc });
      }
    };
    switch (key) {
      case 'stock_movement:create':
        await recordMovement({ id: `${payload.id}:refused`, productId: payload.productId, delta: -payload.delta, reason: 'refused', ref: payload.id, at: Date.now(), locationId: payload.locationId });
        break;
      case 'purchase:create':
        await reverse(payload.items, -1, payload.locationId, payload.id, 'refused', 'refused');
        await db.purchases.delete(payload.id);
        break;
      case 'transfer:create':
        await reverse(payload.items, 1, payload.fromLocationId, payload.id, 'refused', 'refused');
        await db.transfers.delete(payload.id);
        break;
      case 'sale:create':
        await reverse(payload.items, 1, payload.locationId ?? MAIN_LOCATION, payload.id, 'refused', 'refused');
        await db.sales.update(payload.id, { status: 'voided' });
        break;
      case 'location:create':
        await db.locations.delete(payload.id);
        break;
      case 'supplier:create':
        await db.suppliers.delete(payload.id);
        break;
      default:
    }
  });
}

/**
 * A cashier signed in on this device. The database belongs to the device, not the person, so anything a
 * manager's session left here that cashiers must not see (what the shop pays, suppliers, purchases) is removed.
 * Stock numbers are unaffected: they come from movements, which stay.
 */
export async function purgeForCashier(): Promise<void> {
  await db.transaction('rw', [db.products, db.suppliers, db.purchases], async () => {
    for (const p of await db.products.toArray()) {
      if (p.cost || p.costAt) await db.products.put({ ...p, cost: 0, costAt: undefined });
    }
    await db.suppliers.clear();
    await db.purchases.clear();
  });
}
