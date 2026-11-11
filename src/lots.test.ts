import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import * as A from './actions';
import { receivePurchase, voidPurchase } from './purchases';
import { addLot, expiredProductIds, expiryReport, parseDay, removeLot } from './lots';
import { applyChanges, undoRefused } from './syncApply';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 15, 12);
beforeEach(async () => { for (const t of db.tables) await t.clear(); store.clear(); await A.seedDemo(); });

const rice = async () => (await db.products.toArray()).find((p) => p.name.startsWith('Rice'))!;

describe('expiry dates and batches', () => {
  it('reads a date input as the end of that day, and rejects nonsense', () => {
    const t = parseDay('2026-03-05')!;
    expect(new Date(t).getDate()).toBe(5);
    expect(new Date(t).getHours()).toBe(23);
    expect(parseDay('')).toBeUndefined();
    expect(parseDay('05/03/2026')).toBeUndefined();
  });

  it('a purchase with an expiry creates a lot, and cancelling the purchase removes it', async () => {
    const p = await rice();
    const pur = await receivePurchase({ supplierName: 'Dangote', items: [{ productId: p.id, qty: 10, cost: 100, batchNo: 'B7', expiresAt: NOW + 10 * DAY }] });
    const lots = await db.lots.toArray();
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ productId: p.id, qty: 10, batchNo: 'B7', ref: pur.id });
    expect((await db.outbox.toArray()).some((o) => o.entity === 'lot' && o.op === 'create')).toBe(true);
    await voidPurchase(pur.id);
    expect(await db.lots.count()).toBe(0);
    expect((await db.outbox.toArray()).some((o) => o.entity === 'lot' && o.op === 'remove')).toBe(true);
  });

  it('a purchase without an expiry makes no lot', async () => {
    const p = await rice();
    await receivePurchase({ supplierName: 'X', items: [{ productId: p.id, qty: 1, cost: 1 }] });
    expect(await db.lots.count()).toBe(0);
  });

  it('works out what is left per batch: the oldest batch runs out first', async () => {
    const p = await rice();
    await db.products.put({ ...p, stock: 12 });
    await addLot({ productId: p.id, qty: 10, expiresAt: NOW - 2 * DAY, batchNo: 'OLD' }); // 10 old
    await addLot({ productId: p.id, qty: 10, expiresAt: NOW + 5 * DAY, batchNo: 'NEW' }); // 10 new
    const rows = await expiryReport(30, NOW);
    // 12 on the shelf = all 10 of NEW plus 2 of OLD
    expect(rows.map((r) => [r.batchNo, r.remaining, r.expired])).toEqual([['OLD', 2, true], ['NEW', 10, false]]);
    expect([...(await expiredProductIds(NOW))]).toEqual([p.id]);
    await db.products.put({ ...p, stock: 8 });
    expect((await expiryReport(30, NOW)).map((r) => r.batchNo)).toEqual(['NEW']); // OLD is all gone
  });

  it('only lists goods expiring inside the window, and ignores batches that are sold out', async () => {
    const p = await rice();
    await db.products.put({ ...p, stock: 5 });
    await addLot({ productId: p.id, qty: 5, expiresAt: NOW + 90 * DAY });
    expect(await expiryReport(30, NOW)).toEqual([]);
    expect(await expiryReport(120, NOW)).toHaveLength(1);
    await db.products.put({ ...p, stock: 0 });
    expect(await expiryReport(120, NOW)).toEqual([]);
  });

  it('batches belong to a shop: another shop does not see them', async () => {
    const p = await rice();
    await db.products.put({ ...p, stock: 5 });
    await addLot({ productId: p.id, qty: 5, expiresAt: NOW + DAY, locationId: 'elsewhere' });
    expect(await expiryReport(30, NOW)).toEqual([]);
  });

  it('syncs: other devices add and remove lots, and refused lots are taken back', async () => {
    const p = await rice();
    const lot = { id: 'lot1', productId: p.id, locationId: 'main', qty: 3, expiresAt: NOW + DAY };
    await applyChanges([{ seq: 1, entity: 'lot', op: 'create', payload: lot, at: NOW }]);
    await applyChanges([{ seq: 2, entity: 'lot', op: 'create', payload: lot, at: NOW }]); // repeated delivery
    expect(await db.lots.count()).toBe(1);
    await applyChanges([{ seq: 3, entity: 'lot', op: 'remove', payload: { id: 'lot1' }, at: NOW }]);
    expect(await db.lots.count()).toBe(0);
    await db.lots.add(lot);
    await undoRefused('lot', 'create', lot);
    expect(await db.lots.count()).toBe(0);
  });

  it('a lot can be removed by hand', async () => {
    const p = await rice();
    const l = await addLot({ productId: p.id, qty: 1, expiresAt: NOW });
    await removeLot(l.id);
    expect(await db.lots.count()).toBe(0);
  });
});
