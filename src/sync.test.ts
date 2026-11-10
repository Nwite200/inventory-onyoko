import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDb } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { db } from './db';
import * as A from './actions';
import { applyConfig } from './config';
import { api, login, setupAdmin, getSession } from './auth';
import { syncNow } from './sync';

// ---- minimal browser environment ------------------------------------------------------------
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => undefined });
vi.stubGlobal('navigator', { onLine: true });

// ---- two "devices" sharing this one process: swap the local database + storage in and out --------
type Snapshot = { tables: Record<string, unknown[]>; storage: [string, string][] };
const saved = new Map<string, Snapshot>();
let current = '';

async function switchTo(name: string): Promise<void> {
  if (current) {
    const tables: Record<string, unknown[]> = {};
    for (const t of db.tables) tables[t.name] = await t.toArray();
    saved.set(current, { tables, storage: [...store.entries()] });
  }
  for (const t of db.tables) await t.clear();
  store.clear();
  const snap = saved.get(name);
  if (snap) {
    for (const t of db.tables) if (snap.tables[t.name]?.length) await t.bulkAdd(snap.tables[t.name] as never[]);
    snap.storage.forEach(([k, v]) => store.set(k, v));
  }
  current = name;
}

const product = async (prefix: string) => (await db.products.toArray()).find((p) => p.name.startsWith(prefix))!;
const stockOf = async (prefix: string) => (await product(prefix)).stock;

let server: Server;

beforeAll(async () => {
  server = createServer(createApp({ db: openDb(':memory:'), secret: 'it-secret' }));
  await new Promise<void>((r) => server.listen(0, r));
  applyConfig({ serverUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
});
afterAll(() => {
  server.close();
});

describe('two devices through the server', () => {
  it('owner sets up, seeds data on device A, device B receives all of it', async () => {
    await switchTo('A');
    await setupAdmin('owner', 'correct-horse-battery');
    await api('POST', '/api/users', { username: 'amaka', password: 'amaka-pass-123', role: 'cashier' }, getSession()!.token);
    await api('POST', '/api/users', { username: 'chief', password: 'chief-pass-123', role: 'manager' }, getSession()!.token);

    await A.seedDemo();
    const rice = await product('Rice');
    await A.checkout({ items: [{ productId: rice.id, qty: 2 }], customerName: 'Mama Ade', payment: 'cash' });
    await A.adjustStock(rice.id, 10);
    await A.setPrice((await product('Sugar')).id, 1700);
    const r = await syncNow();
    expect(r.pushed).toBeGreaterThan(0);
    expect(await db.outbox.count()).toBe(0);

    await switchTo('B');
    await login('chief', 'chief-pass-123');
    await syncNow();
    expect(await db.products.count()).toBe(7);
    expect(await stockOf('Rice')).toBe(20 - 2 + 10);
    expect((await product('Sugar')).price).toBe(1700);
    const sales = await db.sales.toArray();
    expect(sales).toHaveLength(1);
    expect(sales[0]!.customerName).toBe('Mama Ade');
    expect(await db.customers.count()).toBeGreaterThanOrEqual(2);
  });

  it('retrying a sync changes nothing', async () => {
    const before = await stockOf('Rice');
    await syncNow();
    await syncNow();
    expect(await stockOf('Rice')).toBe(before);
    expect(await db.sales.count()).toBe(1);
  });

  it('both devices sell the same stock while offline, and both end up correct', async () => {
    // B is signed in as chief; sells 4 rice offline (no sync yet)
    const riceB = await product('Rice');
    await A.checkout({ items: [{ productId: riceB.id, qty: 4 }] });
    await switchTo('A');
    // A sells 3 rice offline, too
    const riceA = await product('Rice');
    await A.checkout({ items: [{ productId: riceA.id, qty: 3 }] });

    await syncNow(); // A pushes, nothing new to pull yet from B
    await switchTo('B');
    await syncNow(); // B pushes its sale and pulls A's
    await switchTo('A');
    await syncNow(); // A pulls B's

    const expected = 20 - 2 + 10 - 4 - 3;
    expect(await stockOf('Rice')).toBe(expected);
    expect(await db.sales.count()).toBe(3);
    await switchTo('B');
    expect(await stockOf('Rice')).toBe(expected);
    expect(await db.sales.count()).toBe(3);
  });

  it('voiding a sale on one device returns stock on the other', async () => {
    const sale = (await db.sales.toArray()).find((s) => s.items[0]!.qty === 4)!;
    const before = await stockOf('Rice');
    await A.voidSale(sale.id);
    await syncNow();
    await switchTo('A');
    await syncNow();
    expect(await stockOf('Rice')).toBe(before + 4);
    expect((await db.sales.get(sale.id))!.status).toBe('voided');
  });

  it('price edits: the later change wins on every device', async () => {
    const id = (await product('Coke')).id;
    await A.setPrice(id, 350);
    await syncNow();
    await switchTo('B');
    await new Promise((r) => setTimeout(r, 5));
    await A.setPrice(id, 400); // B changes it later
    await syncNow();
    await switchTo('A');
    await syncNow();
    expect((await product('Coke')).price).toBe(400);
  });

  it('a cashier device gets no cost prices and cannot push product changes', async () => {
    await switchTo('C');
    await login('amaka', 'amaka-pass-123');
    await syncNow();
    expect((await db.products.toArray()).every((p) => p.cost === 0)).toBe(true);
    expect(await db.products.count()).toBe(7);

    // a tampered cashier client tries to change a price anyway
    const id = (await product('Sugar')).id;
    await A.setPrice(id, 1);
    const r = await syncNow();
    expect(r.rejected).toBe(1);
    expect(await db.outbox.count()).toBe(0); // not retried forever
    const log = await db.audit.toArray();
    expect(log.some((l) => l.intent === 'sync_rejected' && /cashier may not update product/.test(l.result))).toBe(true);

    // and the rest of the shop never saw that price
    await switchTo('A');
    await syncNow();
    expect((await product('Sugar')).price).toBe(1700);
  });

  it('a cashier can still sell, and the shop sees it', async () => {
    await switchTo('C');
    await A.checkout({ items: [{ productId: (await product('Fanta')).id, qty: 5 }], customerName: 'Walk-in test' });
    await syncNow();
    await switchTo('A');
    await syncNow();
    expect(await stockOf('Fanta')).toBe(75);
  });

  it('an expired or revoked session signs the device out instead of looping', async () => {
    await switchTo('C');
    const s = getSession()!;
    await api('POST', '/api/users/disable', { username: 'amaka' }, (await (async () => { await switchTo('A'); return getSession()!.token; })()));
    await switchTo('C');
    expect(getSession()).not.toBeNull();
    await expect(syncNow()).rejects.toThrow();
    expect(getSession()).toBeNull(); // forced back to the login screen
    expect(s.username).toBe('amaka');
  });
});
