// Expiry dates. A "lot" is a batch of one product with an expiry date, either received in a purchase or
// added by hand. Stock is still counted by movements; lots only say WHEN some of it expires.
// How much of each lot is left is worked out, not stored: the shop's current stock is assumed to be the
// newest lots (shops sell the oldest first), so the oldest lots are the first to run out.
import { db, uid, type Lot } from './db';
import { queue } from './actions';
import { currentLocationId } from './location';

const DAY = 86_400_000;

/** End of the local day for a yyyy-mm-dd string (what an <input type="date"> gives), or undefined. */
export function parseDay(s: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  return Number.isNaN(d.getTime()) ? undefined : d.getTime();
}

export interface NewLot {
  id?: string;
  productId: string;
  qty: number;
  expiresAt: number;
  batchNo?: string;
  ref?: string;
  locationId?: string;
}

/** Use inside a transaction that already includes db.lots and db.outbox. */
export async function addLotInTransaction(input: NewLot): Promise<Lot> {
  const lot: Lot = {
    id: input.id ?? uid(),
    productId: input.productId,
    locationId: input.locationId ?? currentLocationId(),
    qty: input.qty,
    expiresAt: input.expiresAt,
    ...(input.batchNo?.trim() ? { batchNo: input.batchNo.trim() } : {}),
    ...(input.ref ? { ref: input.ref } : {}),
  };
  await db.lots.put(lot);
  await queue('lot', 'create', lot);
  return lot;
}

/** Records a batch with an expiry date by hand (it does not change stock; stock is counted separately). */
export async function addLot(input: NewLot): Promise<Lot> {
  if (!(input.qty > 0)) throw new Error('Quantity must be more than zero');
  if (!Number.isFinite(input.expiresAt)) throw new Error('Choose an expiry date');
  if (!(await db.products.get(input.productId))) throw new Error('Choose a product');
  return db.transaction('rw', [db.lots, db.outbox], () => addLotInTransaction(input));
}

export async function removeLotsFor(ref: string): Promise<void> {
  const lots = await db.lots.where('ref').equals(ref).toArray();
  for (const l of lots) {
    await db.lots.delete(l.id);
    await queue('lot', 'remove', { id: l.id });
  }
}

export async function removeLot(id: string): Promise<void> {
  await db.transaction('rw', [db.lots, db.outbox], async () => {
    await db.lots.delete(id);
    await queue('lot', 'remove', { id });
  });
}

export interface ExpiryRow {
  lotId: string;
  productId: string;
  name: string;
  batchNo?: string;
  expiresAt: number;
  remaining: number;
  expired: boolean;
}

/**
 * Lots of THIS shop that still have goods and that are expired or expire within `withinDays`.
 * Remaining is allocated newest-lot-first from current stock, so the oldest batches show as used up first.
 */
export async function expiryReport(withinDays = 30, now = Date.now()): Promise<ExpiryRow[]> {
  const loc = currentLocationId();
  const [lots, products] = await Promise.all([db.lots.filter((l) => l.locationId === loc).toArray(), db.products.toArray()]);
  const byProduct = new Map(products.map((p) => [p.id, p]));
  const groups = new Map<string, Lot[]>();
  for (const l of lots) groups.set(l.productId, [...(groups.get(l.productId) ?? []), l]);
  const rows: ExpiryRow[] = [];
  for (const [productId, list] of groups) {
    const p = byProduct.get(productId);
    if (!p) continue;
    let left = Math.max(p.stock, 0);
    for (const l of [...list].sort((a, b) => b.expiresAt - a.expiresAt)) {
      const remaining = Math.min(l.qty, left);
      left -= remaining;
      if (remaining <= 0) continue;
      if (l.expiresAt > now + withinDays * DAY) continue;
      rows.push({ lotId: l.id, productId, name: p.name, batchNo: l.batchNo, expiresAt: l.expiresAt, remaining, expired: l.expiresAt < now });
    }
  }
  return rows.sort((a, b) => a.expiresAt - b.expiresAt);
}

/** Product ids that have expired goods still on the shelf (for the warning at the till). */
export async function expiredProductIds(now = Date.now()): Promise<Set<string>> {
  return new Set((await expiryReport(0, now)).filter((r) => r.expired).map((r) => r.productId));
}
