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
import { addLocation, listLocations, setCurrentLocation, currentLocationId } from './location';
import { addSupplier, receivePurchase, voidPurchase, payPurchase, supplierBalances } from './purchases';
import { sendTransfer, receiveTransfer } from './transfers';
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


let branch = '';
const rice = async () => (await product('Rice'));

describe('shops, purchases and transfers through the server', () => {
  it('sets up an owner, a manager and a cashier, and a second shop', async () => {
    await switchTo('main-till');
    await setupAdmin('owner', 'correct-horse-battery');
    const t = getSession()!.token;
    await api('POST', '/api/users', { username: 'chief', password: 'chief-pass-123', role: 'manager' }, t);
    await api('POST', '/api/users', { username: 'amaka', password: 'amaka-pass-123', role: 'cashier' }, t);
    await A.seedDemo();
    branch = (await addLocation('Ikeja branch')).id;
    expect((await syncNow()).rejected).toBe(0);
    expect(await stockOf('Rice')).toBe(20);
  });

  it('a device set to another shop sees that shop\'s stock, not the first shop\'s', async () => {
    await switchTo('branch-office');
    await login('chief', 'chief-pass-123');
    await syncNow();
    expect((await listLocations()).map((l) => l.name)).toEqual(['Main shop', 'Ikeja branch']);
    expect(await stockOf('Rice')).toBe(20); // still on the main shop
    await setCurrentLocation(branch);
    expect(currentLocationId()).toBe(branch);
    expect(await stockOf('Rice')).toBe(0); // the branch has nothing yet
  });

  it('a purchase adds stock only to the shop that received it, and updates cost and what is owed', async () => {
    const sup = await addSupplier('Dangote Distributors', '0803');
    expect((await addSupplier('dangote distributors')).id).toBe(sup.id); // no duplicates
    const pur = await receivePurchase({ supplierId: sup.id, items: [{ productId: (await rice()).id, qty: 30, cost: 41000 }], paid: 600_000 });
    expect(pur.total).toBe(1_230_000);
    expect(pur.paid).toBe(600_000);
    expect(await stockOf('Rice')).toBe(30);
    expect((await rice()).cost).toBe(41000);
    const bal = (await supplierBalances())[0]!;
    expect([bal.bought, bal.paid, bal.owed]).toEqual([1_230_000, 600_000, 630_000]);
    await expect(payPurchase(pur.id, 700_000)).rejects.toThrow(/still owed/);
    await payPurchase(pur.id, 130_000);
    expect((await supplierBalances())[0]!.owed).toBe(500_000);
    expect((await syncNow()).rejected).toBe(0);
  });

  it('the first shop is untouched, but its owner sees the purchase, supplier, cost and debt', async () => {
    await switchTo('main-till');
    await syncNow();
    expect(await stockOf('Rice')).toBe(20);
    expect((await rice()).cost).toBe(41000);
    expect((await db.suppliers.toArray()).map((s) => s.name)).toEqual(['Dangote Distributors']);
    expect((await supplierBalances())[0]!.owed).toBe(500_000);
    const [p] = await db.purchases.toArray();
    expect(p!.payments).toHaveLength(2);
  });

  it('a cashier in the branch gets the new stock but never prices, suppliers or purchases', async () => {
    await switchTo('branch-till');
    await login('amaka', 'amaka-pass-123');
    await syncNow();
    await setCurrentLocation(branch);
    expect(await stockOf('Rice')).toBe(30);
    expect((await rice()).cost).toBe(0);
    expect(await db.suppliers.count()).toBe(0);
    expect(await db.purchases.count()).toBe(0);
    // and what the cashier sells reduces only the branch
    const sale = await A.checkout({ items: [{ productId: (await rice()).id, qty: 2 }], payment: 'cash' });
    expect(sale.locationId).toBe(branch);
    expect(await stockOf('Rice')).toBe(28);
    expect((await syncNow()).rejected).toBe(0);
  });

  it('a cashier cannot send transfers, receive purchases or open shops (the server refuses)', async () => {
    await A.adjustStock((await rice()).id, 1); // refused: cashiers may not change stock
    await addLocation('Secret shop');
    const r = await syncNow();
    expect(r.rejected).toBe(2);
  });

  it('a transfer takes stock out when sent and puts it in only when the other shop confirms', async () => {
    // cashier's refused changes changed this device's own numbers; start the next part from a clean device
    await switchTo('main-till');
    await syncNow();
    expect(await stockOf('Rice')).toBe(20);
    await expect(sendTransfer({ toLocationId: 'main', items: [{ productId: (await rice()).id, qty: 1 }] })).rejects.toThrow(/different shop/);
    await expect(sendTransfer({ toLocationId: branch, items: [{ productId: (await rice()).id, qty: 99 }] })).rejects.toThrow(/Only 20/);
    const t = await sendTransfer({ toLocationId: branch, items: [{ productId: (await rice()).id, qty: 5 }] });
    expect(await stockOf('Rice')).toBe(15); // gone from the sender
    await expect(receiveTransfer(t.id)).rejects.toThrow(/receiving shop/); // the sender cannot confirm
    expect((await syncNow()).rejected).toBe(0);

    await switchTo('branch-office');
    await syncNow();
    expect(await stockOf('Rice')).toBe(28); // 30 bought - 2 sold, the 5 are still on the road
    expect((await db.transfers.toArray())[0]!.status).toBe('sent');
    await receiveTransfer(t.id);
    expect(await stockOf('Rice')).toBe(33);
    await expect(receiveTransfer(t.id)).rejects.toThrow(/already received/);
    expect((await syncNow()).rejected).toBe(0);

    await switchTo('main-till');
    await syncNow();
    expect(await stockOf('Rice')).toBe(15);
    expect((await db.transfers.toArray())[0]!.status).toBe('received');

    await switchTo('branch-till');
    await syncNow();
    expect(await stockOf('Rice')).toBe(33); // the cashier's shelf is right too
  });

  it('reports can show this shop or every shop', async () => {
    await switchTo('main-till');
    await A.checkout({ items: [{ productId: (await rice()).id, qty: 1 }], payment: 'cash' });
    await syncNow();
    const since = 0;
    expect((await A.salesSummary(since, 'this')).count).toBe(1);
    expect((await A.salesSummary(since, 'all')).count).toBe(2);
  });

  it('cancelling a purchase takes the goods back out of the shop that received them, on every device', async () => {
    await switchTo('branch-office');
    await syncNow();
    const [p] = await db.purchases.toArray();
    await voidPurchase(p!.id);
    expect(await stockOf('Rice')).toBe(3); // 33 - 30
    expect((await supplierBalances())[0]!.owed).toBe(0); // cancelled purchases are not owed
    await syncNow();
    await switchTo('branch-till');
    await syncNow();
    expect(await stockOf('Rice')).toBe(3);
    await switchTo('main-till');
    await syncNow();
    expect(await stockOf('Rice')).toBe(14); // 15 - 1 sold above; the main shop was never touched by the purchase
  });

  it('switching a device to another shop rebuilds the numbers from the history it already holds', async () => {
    await setCurrentLocation(branch);
    expect(await stockOf('Rice')).toBe(3);
    await setCurrentLocation('main');
    expect(await stockOf('Rice')).toBe(14);
  });

  it('a shared till: after a cashier signs in, prices are gone; when the manager returns, everything is back', async () => {
    await switchTo('shared-till');
    await login('chief', 'chief-pass-123');
    await syncNow();
    expect(await db.suppliers.count()).toBe(1);
    expect(await db.purchases.count()).toBe(1);
    expect((await rice()).cost).toBe(41000);

    await login('amaka', 'amaka-pass-123'); // same device, a cashier now
    expect(await db.suppliers.count()).toBe(0);
    expect(await db.purchases.count()).toBe(0);
    expect((await db.products.toArray()).every((p) => !p.cost)).toBe(true);
    const stock = await stockOf('Rice');
    await syncNow();
    expect(await stockOf('Rice')).toBe(stock); // shelf numbers unaffected
    expect(await db.purchases.count()).toBe(0); // and the cashier feed still hides them

    await login('chief', 'chief-pass-123'); // the manager comes back
    await syncNow();
    expect(await db.suppliers.count()).toBe(1);
    expect(await db.purchases.count()).toBe(1);
    expect((await rice()).cost).toBe(41000);
    expect(await stockOf('Rice')).toBe(stock); // replaying history changed no stock
  });
});
