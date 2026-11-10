// Moving goods between shops. Sending takes stock out of the sending shop straight away;
// the receiving shop adds it only when someone there confirms the goods arrived.
// While in transit the goods are in neither shop's count, so nothing is counted twice.
import { db, uid, type Transfer } from './db';
import { queue } from './actions';
import { currentLocationId, listLocations } from './location';
import { recordMovement } from './stock';
import { config } from './config';

export async function sendTransfer(input: { toLocationId: string; items: { productId: string; qty: number }[]; note?: string }): Promise<Transfer> {
  const from = currentLocationId();
  if (input.toLocationId === from) throw new Error('Choose a different shop to send to');
  if (!(await listLocations()).some((l) => l.id === input.toLocationId)) throw new Error('Unknown destination shop');
  if (input.items.length === 0) throw new Error('Add at least one product');

  return db.transaction('rw', [db.products, db.stockMovements, db.transfers, db.outbox], async () => {
    const merged = new Map<string, number>();
    for (const it of input.items) {
      if (!(it.qty > 0)) throw new Error('Quantity must be more than zero');
      merged.set(it.productId, (merged.get(it.productId) ?? 0) + it.qty);
    }
    const items = [];
    for (const [productId, qty] of merged) {
      const p = await db.products.get(productId);
      if (!p) throw new Error('A product in this transfer no longer exists');
      if (p.stock < qty && !config.allowNegativeStock) throw new Error(`Only ${p.stock} ${p.name} in this shop`);
      items.push({ productId, name: p.name, qty });
    }
    const sentAt = Date.now();
    const d = new Date(sentAt);
    const count = await db.transfers.count();
    const t: Transfer = {
      id: uid(),
      number: `TR-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(count + 1).padStart(4, '0')}`,
      fromLocationId: from,
      toLocationId: input.toLocationId,
      items,
      status: 'sent',
      sentAt,
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    };
    await db.transfers.add(t);
    for (const it of items) {
      await recordMovement({ id: `${t.id}:${it.productId}:out`, productId: it.productId, delta: -it.qty, reason: 'transfer_out', ref: t.id, at: sentAt, locationId: from });
    }
    await queue('transfer', 'create', t);
    return t;
  });
}

/** Confirms the goods arrived. Only the destination shop's device may do this. */
export async function receiveTransfer(transferId: string): Promise<Transfer> {
  return db.transaction('rw', [db.products, db.stockMovements, db.transfers, db.outbox], async () => {
    const t = await db.transfers.get(transferId);
    if (!t) throw new Error('Transfer not found (it may not have reached this device yet)');
    if (t.status === 'received') throw new Error('This transfer was already received');
    if (t.toLocationId !== currentLocationId()) throw new Error('Only the receiving shop can confirm this transfer');
    const at = Date.now();
    for (const it of t.items) {
      await recordMovement({ id: `${t.id}:${it.productId}:in`, productId: it.productId, delta: it.qty, reason: 'transfer_in', ref: t.id, at, locationId: t.toLocationId });
    }
    const done: Transfer = { ...t, status: 'received', receivedAt: at };
    await db.transfers.put(done);
    await queue('transfer', 'receive', { id: t.id, toLocationId: t.toLocationId, items: t.items.map((i) => ({ productId: i.productId, qty: i.qty })) });
    return done;
  });
}
