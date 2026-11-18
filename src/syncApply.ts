// Applies changes made on OTHER devices to this device's local database.
// Rules (so devices converge no matter the order or repeats):
//  - Stock is event-based: sales and stock movements add/subtract, they never overwrite a number.
//  - Records are keyed by client-generated ids, so applying the same change twice does nothing.
//  - Prices are last-write-wins, using the time the price was set (priceAt).
// These writes deliberately bypass the outbox, otherwise every change would bounce back to the server forever.
import { db, type CashRegister, type Expense, type JournalEntry, type Lot, type Product, type Purchase, type Sale, type SaleReturn, type StockMovement, type Transfer } from './db';
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
      if (!existing) return;
      let next = existing;
      if (typeof p.price === 'number' && c.at >= (existing.priceAt ?? 0)) next = { ...next, price: p.price, priceAt: c.at, updatedAt: Date.now() };
      if (typeof p.sku === 'string' && c.at >= (existing.skuAt ?? 0)) next = { ...next, sku: p.sku, skuAt: c.at, updatedAt: Date.now() };
      if (next !== existing) await db.products.put(next);
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
        for (const serialId of l.serials ?? []) {
          const serial = await db.serials.get(serialId);
          if (serial) await db.serials.put({ ...serial, status: 'sold', saleId: sale.id, updatedAt: Date.now() });
        }
        for (const pick of l.binPicks ?? []) {
          await db.binMovements.put({
            id: `${sale.id}:${l.productId}:${pick.binId}:bin`, productId: l.productId, binId: pick.binId,
            delta: -pick.qty, reason: 'sale_pick', ref: sale.id, at: sale.at, locationId: sale.locationId ?? MAIN_LOCATION,
          });
        }
      }
      return;
    }
    case 'sale:void': {
      const sale = await db.sales.get(p.id);
      if (!sale || sale.status === 'voided') return;
      for (const l of sale.items) {
        await recordMovement({ id: `${sale.id}:${l.productId}:void`, productId: l.productId, delta: l.qty, reason: 'void', ref: sale.id, at: c.at, locationId: sale.locationId });
        for (const serialId of l.serials ?? []) {
          const serial = await db.serials.get(serialId);
          if (serial) await db.serials.put({ ...serial, status: 'in_stock', saleId: undefined, updatedAt: Date.now() });
        }
        for (const pick of l.binPicks ?? []) {
          await db.binMovements.put({
            id: `${sale.id}:${l.productId}:${pick.binId}:voidbin`, productId: l.productId, binId: pick.binId,
            delta: pick.qty, reason: 'sale_void', ref: sale.id, at: c.at, locationId: sale.locationId ?? MAIN_LOCATION,
          });
        }
      }
      await db.sales.put({ ...sale, status: 'voided' });
      return;
    }
    case 'lot:create': {
      if (!(await db.lots.get(p.id))) await db.lots.add(p as Lot);
      return;
    }
    case 'lot:remove': {
      await db.lots.delete(p.id);
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
      await db.lots.where('ref').equals(p.id).delete();
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
    case 'expense:create': {
      if (!(await db.expenses.get(p.id))) await db.expenses.add(p as Expense);
      return;
    }
    case 'sale_return:create': {
      if (await db.returns.get(p.id)) return;
      const ret = p as SaleReturn;
      await db.returns.add(ret);
      for (const it of ret.items) {
        if (it.condition !== 'restock') continue;
        await recordMovement({
          id: `${ret.id}:${it.productId}:restock`,
          productId: it.productId,
          delta: it.qty,
          reason: 'return_restock',
          ref: ret.id,
          at: ret.at,
          locationId: ret.locationId,
        });
      }
      for (const it of ret.items) {
        for (const b of it.binReturns ?? []) {
          await db.binMovements.put({
            id: `${ret.id}:${it.productId}:${b.binId}:bin`, productId: it.productId, binId: b.binId,
            delta: b.qty, reason: 'return_restock', ref: ret.id, at: ret.at, locationId: ret.locationId ?? MAIN_LOCATION,
          });
        }
        for (const serialId of it.serials ?? []) {
          const serial = await db.serials.get(serialId);
          if (serial) await db.serials.put({
            ...serial,
            status: it.condition === 'restock' ? 'in_stock' : 'damaged',
            saleId: it.condition === 'restock' ? undefined : serial.saleId,
            updatedAt: Date.now(),
          });
        }
      }
      return;
    }
    case 'cash_register:open': {
      if (!(await db.registers.get(p.id))) await db.registers.add(p as CashRegister);
      return;
    }
    case 'cash_register:close': {
      const existing = await db.registers.get(p.id);
      if (!existing) await db.registers.add(p as CashRegister);
      else await db.registers.put({ ...existing, ...(p as CashRegister) });
      return;
    }
    case 'journal:create': {
      if (!(await db.journals.get(p.id))) await db.journals.add(p as JournalEntry);
      return;
    }
    case 'advanced:upsert': {
      if (typeof p.table !== 'string' || !p.record || typeof p.record !== 'object') return;
      await db.table(p.table).put(p.record as Record<string, unknown>);
      return;
    }
    case 'advanced:delete': {
      if (typeof p.table !== 'string' || typeof p.record?.id !== 'string') return;
      await db.table(p.table).delete(p.record.id);
      return;
    }
    default:
    // unknown change from a newer server version: skip rather than crash
  }
}

export async function applyChanges(changes: RemoteChange[]): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
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
  await db.transaction('rw', db.tables, async () => {
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
      case 'lot:create':
        await db.lots.delete(payload.id);
        break;
      case 'location:create':
        await db.locations.delete(payload.id);
        break;
      case 'supplier:create':
        await db.suppliers.delete(payload.id);
        break;
      case 'expense:create':
        await db.expenses.delete(payload.id);
        break;
      case 'sale_return:create': {
        const ret = await db.returns.get(payload.id);
        if (ret) {
          for (const it of ret.items) {
            if (it.condition !== 'restock') continue;
            await recordMovement({ id: `${ret.id}:${it.productId}:refused`, productId: it.productId, delta: -it.qty, reason: 'refused', ref: ret.id, at: Date.now(), locationId: ret.locationId });
          }
          await db.returns.delete(ret.id);
        }
        break;
      }
      case 'journal:create':
        await db.journals.delete(payload.id);
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
  const sensitive = ['expenses', 'journals', 'customerPayments', 'payslips', 'assets', 'budgets', 'approvals', 'bankAccounts', 'bankTransactions', 'saleDocuments', 'employees', 'productionOrders'];
  await db.transaction('rw', db.tables, async () => {
    for (const p of await db.products.toArray()) {
      if (p.cost || p.costAt) await db.products.put({ ...p, cost: 0, costAt: undefined });
    }
    await db.suppliers.clear();
    await db.purchases.clear();
    for (const name of sensitive) await db.table(name).clear();
  });
}

/** Forgets everything stored on this device (used when a different business signs in). */
export async function wipeLocalData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
}
