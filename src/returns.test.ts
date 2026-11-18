import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import * as A from './actions';
import { refundSale, returnedQuantities } from './returns';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  store.clear();
  await A.seedDemo();
});

const rice = async () => (await db.products.toArray()).find((p) => p.name.startsWith('Rice'))!;

describe('refunds', () => {
  it('refunds, restocks once and records the sync event', async () => {
    const product = await rice();
    const sale = await A.checkout({ items: [{ productId: product.id, qty: 5 }], payment: 'cash' });
    const before = (await db.products.get(product.id))!.stock;
    const ret = await refundSale({
      saleId: sale.id,
      items: [{ productId: product.id, qty: 2, condition: 'restock' }],
      paymentMethod: 'cash',
      reason: 'Wrong size',
    });
    expect(ret.totalRefunded).toBe(2 * product.price);
    expect(ret.items[0]!.condition).toBe('restock');
    expect((await db.products.get(product.id))!.stock).toBe(before + 2);
    expect((await db.stockMovements.toArray()).filter((m) => m.ref === ret.id)).toHaveLength(1);
    expect(await db.outbox.filter((x) => x.entity === 'sale_return').count()).toBe(1);
    expect((await returnedQuantities(sale.id)).get(product.id)).toBe(2);
  });

  it('never refunds more than was sold, even across several refunds', async () => {
    const product = await rice();
    const sale = await A.checkout({ items: [{ productId: product.id, qty: 5 }], payment: 'cash' });
    await refundSale({ saleId: sale.id, items: [{ productId: product.id, qty: 2, condition: 'restock' }] });
    await expect(
      refundSale({ saleId: sale.id, items: [{ productId: product.id, qty: 4, condition: 'restock' }] }),
    ).rejects.toThrow(/Only 3/);
    // the failed attempt must not have moved stock
    expect((await returnedQuantities(sale.id)).get(product.id)).toBe(2);
  });

  it('does not restock damaged goods', async () => {
    const product = await rice();
    const sale = await A.checkout({ items: [{ productId: product.id, qty: 5 }], payment: 'cash' });
    const before = (await db.products.get(product.id))!.stock;
    const ret = await refundSale({
      saleId: sale.id,
      items: [{ productId: product.id, qty: 1, condition: 'damaged' }],
      paymentMethod: 'cash',
    });
    expect((await db.products.get(product.id))!.stock).toBe(before);
    expect((await db.stockMovements.toArray()).filter((m) => m.ref === ret.id)).toHaveLength(0);
  });

  it('refuses to refund a voided sale', async () => {
    const product = await rice();
    const sale = await A.checkout({ items: [{ productId: product.id, qty: 2 }], payment: 'cash' });
    await A.voidSale(sale.id);
    await expect(refundSale({ saleId: sale.id, items: [{ productId: product.id, qty: 1, condition: 'restock' }] })).rejects.toThrow(/voided/);
  });

  it('refuses an item that was not on the sale', async () => {
    const product = await rice();
    const other = (await db.products.toArray()).find((p) => p.name.startsWith('Coke'))!;
    const sale = await A.checkout({ items: [{ productId: product.id, qty: 2 }], payment: 'cash' });
    await expect(refundSale({ saleId: sale.id, items: [{ productId: other.id, qty: 1, condition: 'restock' }] })).rejects.toThrow(/not part of this sale/);
  });
});
