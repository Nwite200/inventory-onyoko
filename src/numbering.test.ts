import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import * as A from './actions';
import { receivePurchase, addSupplier } from './purchases';
import { addLocation } from './location';
import { sendTransfer } from './transfers';
import { deviceCode } from './numbering';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });

beforeEach(async () => { for (const t of db.tables) await t.clear(); store.clear(); await A.seedDemo(); });

describe('document numbers', () => {
  it('look like INV-YYYYMMDD-CODE-0001 and count up on this device each day', async () => {
    const rice = (await db.products.toArray()).find((p) => p.name.startsWith('Rice'))!;
    const s1 = await A.checkout({ items: [{ productId: rice.id, qty: 1 }], payment: 'cash' });
    const s2 = await A.checkout({ items: [{ productId: rice.id, qty: 1 }], payment: 'cash' });
    expect(s1.number).toMatch(/^INV-\d{8}-[A-Z2-9]{3}-0001$/);
    expect(s2.number).toBe(s1.number.replace('0001', '0002'));
  });

  it('two devices never issue the same number, even on the same day with the same count', async () => {
    const rice = (await db.products.toArray()).find((p) => p.name.startsWith('Rice'))!;
    await db.products.put({ ...rice, stock: 1000 });
    const numbers = new Set<string>();
    for (let device = 0; device < 40; device++) {
      store.clear();
      store.set('openpos.deviceId', (((device + 1) * 2654435761) >>> 0).toString(16).padStart(8, '0') + '-0000-4000-8000-000000000000'); // a different till
      await db.sales.clear();
      numbers.add((await A.checkout({ items: [{ productId: rice.id, qty: 1 }], payment: 'cash' })).number);
    }
    // 40 tills (fixed ids, so the result is the same every run), each issuing its first receipt of the day
    expect(numbers.size).toBe(40);
  });

  it('a sale that arrived from another device does not disturb this device\'s count', async () => {
    const rice = (await db.products.toArray()).find((p) => p.name.startsWith('Rice'))!;
    await db.sales.add({ id: 'x', number: 'INV-20990101-ZZZ-0001', at: Date.now(), customerName: 'Walk-in', payment: 'cash', items: [], total: 0, status: 'completed' });
    await db.sales.add({ id: 'y', number: 'INV-20990101-ZZZ-0002', at: Date.now(), customerName: 'Walk-in', payment: 'cash', items: [], total: 0, status: 'completed' });
    expect((await A.checkout({ items: [{ productId: rice.id, qty: 1 }], payment: 'cash' })).number).toMatch(/-0001$/);
  });

  it('purchases and transfers are numbered the same way', async () => {
    const rice = (await db.products.toArray()).find((p) => p.name.startsWith('Rice'))!;
    const sup = await addSupplier('Dangote');
    const po = await receivePurchase({ supplierId: sup.id, items: [{ productId: rice.id, qty: 1, cost: 10 }] });
    const branch = await addLocation('Ikeja');
    const tr = await sendTransfer({ toLocationId: branch.id, items: [{ productId: rice.id, qty: 1 }] });
    expect(po.number).toMatch(/^PO-\d{8}-[A-Z2-9]{3}-0001$/);
    expect(tr.number).toMatch(/^TR-\d{8}-[A-Z2-9]{3}-0001$/);
    expect(po.number.split('-')[2]).toBe(deviceCode());
  });

  it('the device code is stable for a device and avoids look-alike characters', () => {
    expect(deviceCode('0a1b2c3d-0000-4000-8000-000000000000')).toBe(deviceCode('0a1b2c3d-0000-4000-8000-000000000000'));
    for (let i = 0; i < 500; i++) expect(deviceCode(crypto.randomUUID())).toMatch(/^[A-HJ-NP-Z2-9]{3}$/);
  });
});
