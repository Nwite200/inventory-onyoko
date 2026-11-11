import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import * as A from './actions';
import { applyChanges } from './syncApply';
import { buildLabel } from './printing/receipt';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
beforeEach(async () => { for (const t of db.tables) await t.clear(); store.clear(); await A.seedDemo(); });

describe('barcodes on products', () => {
  it('gives every product without one a unique 9-digit code, and keeps existing codes', async () => {
    const [first] = await db.products.toArray();
    await A.setSku(first!.id, 'MY-CODE-1');
    const n = await A.assignMissingSkus();
    const all = await db.products.toArray();
    expect(n).toBe(all.length - 1 - all.filter((p) => p.sku && p.sku !== 'MY-CODE-1' && !/^2\d{8}$/.test(p.sku)).length);
    expect(all.every((p) => p.sku)).toBe(true);
    expect(new Set(all.map((p) => p.sku)).size).toBe(all.length); // all different
    expect((await db.products.get(first!.id))!.sku).toBe('MY-CODE-1');
    expect(await A.assignMissingSkus()).toBe(0); // nothing left to give
  });
  it('refuses a duplicate or an unwritable barcode', async () => {
    const [a, b] = await db.products.toArray();
    await A.setSku(a!.id, 'DUP-1');
    await expect(A.setSku(b!.id, 'DUP-1')).rejects.toThrow(/already uses/);
    await expect(A.setSku(b!.id, 'café')).rejects.toThrow(/no accents/);
    await A.setSku(a!.id, 'DUP-1'); // the same product keeping its own code is fine
  });
  it('a barcode change reaches other devices, and the latest change wins', async () => {
    const [p] = await db.products.toArray();
    await A.setSku(p!.id, 'NEW-1');
    expect((await db.outbox.toArray()).some((o) => o.entity === 'product' && o.op === 'update' && (o.payload as { sku?: string }).sku === 'NEW-1')).toBe(true);
    await applyChanges([{ seq: 1, entity: 'product', op: 'update', payload: { id: p!.id, sku: 'OLDER' }, at: 5 }]); // older than ours
    expect((await db.products.get(p!.id))!.sku).toBe('NEW-1');
    await applyChanges([{ seq: 2, entity: 'product', op: 'update', payload: { id: p!.id, sku: 'NEWER' }, at: Date.now() + 1000 }]);
    expect((await db.products.get(p!.id))!.sku).toBe('NEWER');
    expect((await db.products.get(p!.id))!.price).toBeGreaterThan(0); // price untouched by a barcode-only change
  });
  it('a scanned code finds the product at the till (same lookup the Sell screen uses)', async () => {
    const [p] = await db.products.toArray();
    await A.setSku(p!.id, '200000001');
    expect((await db.products.toArray()).find((x) => x.sku === '200000001')!.id).toBe(p!.id);
  });
});

describe('thermal price labels', () => {
  it('print name, barcode and price, once per copy, with a cut after each', () => {
    const bytes = [...buildLabel({ name: 'Rice 50kg Bag', sku: '200000001', price: 45000 }, { width: 32, money: (n) => 'N' + n, copies: 3, cut: true })];
    const text = String.fromCharCode(...bytes.map((b) => (b >= 32 && b < 127 ? b : 10)));
    expect((text.match(/\{B200000001/g) ?? []).length).toBe(3);
    expect((text.match(/Rice 50kg Bag/g) ?? []).length).toBe(3);
    expect((text.match(/N45000/g) ?? []).length).toBe(3);
    let cuts = 0;
    for (let i = 0; i < bytes.length - 3; i++) if (bytes[i] === 0x1d && bytes[i + 1] === 0x56 && bytes[i + 2] === 0x42) cuts++;
    expect(cuts).toBe(3);
  });
});
