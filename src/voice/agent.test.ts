import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import * as A from '../actions';
import { VoiceAgent, type Role } from './agent';

let role: Role = 'admin';
let agent: VoiceAgent;

const stockOf = async (name: string) => (await db.products.toArray()).find((p) => p.name.startsWith(name))!.stock;

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  await A.seedDemo();
  role = 'admin';
  agent = new VoiceAgent(() => role);
});

describe('offline sale flow', () => {
  it('sells by voice only after confirmation, and queues it for sync', async () => {
    const r1 = await agent.handle('sell two bags of rice to mama ade cash');
    expect(r1.pending).toContain('Rice 50kg Bag');
    expect(r1.pending).toContain('Mama Ade');
    expect(await stockOf('Rice')).toBe(20); // nothing changed yet

    const r2 = await agent.handle('yes');
    expect(r2.text).toMatch(/Done\. Sale INV-/);
    expect(await stockOf('Rice')).toBe(18);
    const sales = await db.sales.toArray();
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ customerName: 'Mama Ade', payment: 'cash', total: 90000 });
    const outbox = await db.outbox.toArray();
    expect(outbox.some((o) => o.entity === 'sale' && o.op === 'create')).toBe(true);
  });

  it('cancel discards the pending sale', async () => {
    await agent.handle('sell 3 sugar');
    await agent.handle('no');
    expect(await stockOf('Sugar')).toBe(30);
    expect((await agent.handle('yes')).text).toMatch(/nothing to confirm/i);
  });

  it('refuses to oversell', async () => {
    await agent.handle('sell 5 spaghetti');
    const r = await agent.handle('yes');
    expect(r.text).toMatch(/Only 3 Spaghetti Pack in stock/);
    expect(await stockOf('Spaghetti')).toBe(3);
  });

  it('undo reverses the last sale', async () => {
    await agent.handle('sell 2 sugar');
    await agent.handle('yes');
    expect(await stockOf('Sugar')).toBe(28);
    const r = await agent.handle('undo');
    expect(r.text).toMatch(/Undone/);
    expect(await stockOf('Sugar')).toBe(30);
    expect((await db.sales.toArray())[0]!.status).toBe('voided');
  });
});

describe('stock and price', () => {
  it('adds stock and writes a movement', async () => {
    const r = await agent.handle('add fifty cartons of indomie to stock');
    expect(r.pending).toContain('40 to 90');
    await agent.handle('confirm');
    expect(await stockOf('Indomie')).toBe(90);
    const mv = await db.stockMovements.toArray();
    expect(mv.some((m) => m.delta === 50 && m.reason === 'voice')).toBe(true);
  });

  it('checks stock immediately without confirmation', async () => {
    const r = await agent.handle('how much sugar is left');
    expect(r.text).toBe('Sugar 1kg: 30 packs in stock.');
    expect(r.pending).toBeNull();
  });

  it('changes price after confirmation and can undo it', async () => {
    await agent.handle('change the price of sugar to 1,500');
    await agent.handle('yes');
    expect((await db.products.toArray()).find((p) => p.name.startsWith('Sugar'))!.price).toBe(1500);
    await agent.handle('undo');
    expect((await db.products.toArray()).find((p) => p.name.startsWith('Sugar'))!.price).toBe(1800);
  });

  it('reports low stock and daily sales', async () => {
    expect((await agent.handle("what's running low")).text).toMatch(/Spaghetti Pack \(3\)/);
    await agent.handle('sell 2 sugar');
    await agent.handle('yes');
    expect((await agent.handle('what did I sell today')).text).toMatch(/1 sale, ₦3,600 total/);
  });
});

describe('ambiguity and safety', () => {
  it('asks which product when two match, then continues', async () => {
    const r = await agent.handle('sell 2 bottle');
    expect(r.text).toMatch(/Did you mean/);
    const r2 = await agent.handle('the first one');
    expect(r2.pending).toMatch(/Sell 2 /);
  });

  it('says so when a product is unknown', async () => {
    expect((await agent.handle('sell 2 laptops')).text).toMatch(/couldn't find "laptops"/);
  });

  it('enforces role permissions', async () => {
    role = 'cashier';
    expect((await agent.handle('change the price of sugar to 1')).text).toMatch(/not allowed/);
    expect((await agent.handle('add 10 sugar')).text).toMatch(/not allowed/);
    expect((await agent.handle('sell 1 sugar')).pending).toBeTruthy(); // cashiers may sell
  });

  it('audits every command', async () => {
    await agent.handle('how many fanta');
    await agent.handle('sell 1 sugar');
    const log = await db.audit.toArray();
    expect(log.map((l) => l.intent)).toEqual(['check_stock', 'sell']);
    expect(log[0]!.transcript).toBe('how many fanta');
  });

  it('LLM fallback result still needs confirmation', async () => {
    const llmAgent = new VoiceAgent(() => role, async () => ({ type: 'sell', items: [{ qty: 1, name: 'fanta' }] }));
    const r = await llmAgent.handle('abeg give customer one fanta');
    expect(r.pending).toMatch(/Sell 1 Fanta/);
    expect(await stockOf('Fanta')).toBe(80);
  });
});

// ---- purchases, suppliers and transfers by voice --------------------------------------------------
import { vi } from 'vitest';
import { config } from '../config';
import { addLocation, setCurrentLocation, currentLocationId } from '../location';
import { supplierBalances } from '../purchases';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
const product = async (name: string) => (await db.products.toArray()).find((p) => p.name.startsWith(name))!;

describe('buying from suppliers by voice', () => {
  beforeEach(() => { store.clear(); config.features.purchases = true; config.features.transfers = true; });

  it('reads the purchase back with the money, and only changes stock after "yes"', async () => {
    const r = await agent.handle('received 10 bags of rice from Dangote at 41000 each, paid 100000');
    expect(r.pending).toMatch(/Receive 10 Rice 50kg Bag at ₦41,000 from Dangote \(new supplier\)/);
    expect(r.pending).toMatch(/Total ₦410,000, paid ₦100,000, owing ₦310,000/);
    expect(await stockOf('Rice')).toBe(20);
    expect(await db.purchases.count()).toBe(0);

    const done = await agent.handle('yes');
    expect(done.text).toMatch(/Done\. Purchase PO-/);
    expect(await stockOf('Rice')).toBe(30);
    expect((await product('Rice')).cost).toBe(41000);
    const [bal] = await supplierBalances();
    expect([bal!.supplier.name, bal!.bought, bal!.paid, bal!.owed]).toEqual(['Dangote', 410000, 100000, 310000]);
    expect((await db.outbox.toArray()).some((o) => o.entity === 'purchase' && o.op === 'create')).toBe(true);
  });

  it('"undo" cancels the purchase and takes the goods back out', async () => {
    await agent.handle('received 10 rice from Dangote at 41000 each');
    await agent.handle('yes');
    expect((await agent.handle('undo')).text).toMatch(/Undone: purchase PO-/);
    expect(await stockOf('Rice')).toBe(20);
    expect((await supplierBalances())[0]!.owed).toBe(0);
  });

  it('recognises an existing supplier by a sloppy spoken name instead of creating a duplicate', async () => {
    await agent.handle('received 5 rice from Dangote Distributors at 41000 each, on credit');
    await agent.handle('yes');
    const r = await agent.handle('received 5 sugar from dangote distributor at 900 each');
    expect(r.pending).not.toMatch(/new supplier/);
    await agent.handle('yes');
    expect(await db.suppliers.count()).toBe(1);
  });

  it('asks for the price when it does not know one, and never guesses', async () => {
    await db.products.toArray().then((ps) => Promise.all(ps.map((p) => db.products.put({ ...p, cost: 0 }))));
    const r = await agent.handle('received 10 rice from Dangote');
    expect(r.text).toMatch(/What did you pay for Rice 50kg Bag\?/);
    expect(r.pending).toBeFalsy();
    expect(await db.purchases.count()).toBe(0);
  });

  it('uses the last known cost when no price is spoken', async () => {
    const r = await agent.handle('received 10 rice from Dangote');
    expect(r.pending).toMatch(/Rice 50kg Bag at ₦/); // the demo product has a cost
  });

  it('refuses a payment bigger than the goods', async () => {
    const r = await agent.handle('received 1 rice from Dangote at 41000 each, paid 99999');
    expect(r.text).toMatch(/goods come to ₦41,000/);
    expect(await db.purchases.count()).toBe(0);
  });

  it('"paid in full" and "on credit" set the amounts', async () => {
    expect((await agent.handle('received 2 rice from Dangote at 1000 each paid in full')).pending).toMatch(/paid in full/);
    expect((await agent.handle('received 2 rice from Dangote at 1000 each on credit')).pending).toMatch(/nothing paid yet, so you will owe ₦2,000/);
  });
});

describe('what you owe and paying suppliers by voice', () => {
  beforeEach(async () => {
    store.clear(); config.features.purchases = true;
    await agent.handle('received 10 rice from Dangote at 41000 each, paid 100000'); await agent.handle('yes'); // owe 310,000
    await agent.handle('received 4 sugar from Mama Nkechi at 1000 each on credit'); await agent.handle('yes'); // owe 4,000
  });

  it('answers how much is owed, in total and per supplier', async () => {
    expect((await agent.handle('how much do I owe')).text).toBe('You owe ₦314,000 in total: Dangote ₦310,000, Mama Nkechi ₦4,000.');
    expect((await agent.handle('how much do I owe Dangote')).text).toMatch(/You owe Dangote ₦310,000 \(bought ₦410,000, paid ₦100,000\)/);
    expect((await agent.handle('how much do I owe Nobody Ltd')).text).toMatch(/couldn't find a supplier/);
  });

  it('pays a supplier after confirmation, spread over the oldest purchases first', async () => {
    await agent.handle('received 1 rice from Dangote at 5000 each, on credit'); await agent.handle('yes'); // second Dangote purchase, owe 315,000
    const r = await agent.handle('pay Dangote 312000');
    expect(r.pending).toMatch(/Pay Dangote ₦312,000\. You owe ₦315,000, so ₦3,000 will remain/);
    expect((await supplierBalances()).find((b) => b.supplier.name === 'Dangote')!.owed).toBe(315000); // nothing yet
    expect((await agent.handle('yes')).text).toMatch(/Recorded: paid Dangote ₦312,000/);
    expect((await supplierBalances()).find((b) => b.supplier.name === 'Dangote')!.owed).toBe(3000);
    const purchases = (await db.purchases.toArray()).filter((p) => p.supplierName === 'Dangote').sort((a, b) => a.at - b.at);
    expect(purchases[0]!.total - purchases[0]!.paid).toBe(0); // the oldest was cleared first
  });

  it('refuses to overpay or pay someone who is owed nothing', async () => {
    expect((await agent.handle('pay Mama Nkechi 5000')).text).toMatch(/only owe Mama Nkechi ₦4,000/);
    await agent.handle('pay Mama Nkechi 4000'); await agent.handle('yes');
    expect((await agent.handle('pay Mama Nkechi 100')).text).toMatch(/don't owe Mama Nkechi anything/);
  });
});

describe('transfers between shops by voice', () => {
  let branchId = '';
  beforeEach(async () => { store.clear(); config.features.transfers = true; branchId = (await addLocation('Ikeja branch')).id; });

  it('sends goods after confirmation and takes them out of this shop at once', async () => {
    const r = await agent.handle('transfer 5 bags of rice to Ikeja branch');
    expect(r.pending).toMatch(/Send 5 Rice 50kg Bag from Main shop to Ikeja branch/);
    expect(await stockOf('Rice')).toBe(20);
    expect((await agent.handle('yes')).text).toMatch(/Sent TR-.* to Ikeja branch/);
    expect(await stockOf('Rice')).toBe(15);
    expect((await agent.handle('undo')).text).toMatch(/nothing to undo/i); // by design: not undoable by voice
  });

  it('understands the shop even when it is spoken loosely', async () => {
    expect((await agent.handle('send 2 sugar to ikeja')).pending).toMatch(/to Ikeja branch/);
  });

  it('refuses unknown shops (naming the real ones) and amounts the shop does not have', async () => {
    expect((await agent.handle('transfer 2 rice to Abuja')).text).toMatch(/couldn't find a shop called "abuja"\. Your other shops: Ikeja branch/);
    expect((await agent.handle('transfer 500 rice to Ikeja branch')).text).toMatch(/only have 20 Rice 50kg Bag in Main shop/i);
  });

  it('the receiving shop confirms arrival by voice, and only then gets the stock', async () => {
    await agent.handle('transfer 5 rice to Ikeja branch'); await agent.handle('yes');
    expect((await agent.handle('transfer arrived')).text).toMatch(/Nothing is on the way to this shop/); // the sender has nothing incoming

    await setCurrentLocation(branchId);
    expect(currentLocationId()).toBe(branchId);
    expect(await stockOf('Rice')).toBe(0);
    const r = await agent.handle('transfer arrived');
    expect(r.pending).toMatch(/Confirm that 5 Rice 50kg Bag arrived from Main shop/);
    expect(await stockOf('Rice')).toBe(0);
    expect((await agent.handle('yes')).text).toMatch(/Received TR-.*Stock updated/);
    expect(await stockOf('Rice')).toBe(5);
    expect((await agent.handle('transfer arrived')).text).toMatch(/Nothing is on the way/);
  });

  it('with several transfers on the way it asks which, instead of guessing', async () => {
    await agent.handle('transfer 1 rice to Ikeja branch'); await agent.handle('yes');
    await agent.handle('transfer 1 sugar to Ikeja branch'); await agent.handle('yes');
    await setCurrentLocation(branchId);
    expect((await agent.handle('transfer arrived')).text).toMatch(/2 transfers are on the way/);
    expect((await agent.handle('receive transfer from main shop')).text).toMatch(/2 transfers are on the way/); // still two from that shop
  });

  it('says so plainly when there is only one shop', async () => {
    await db.locations.clear();
    expect((await agent.handle('transfer 5 rice to Ikeja branch')).text).toMatch(/only have one shop/);
  });
});

describe('who and what is allowed', () => {
  beforeEach(() => { store.clear(); config.features.purchases = true; config.features.transfers = true; });
  it('cashiers cannot buy, pay suppliers, ask what is owed, or move stock between shops', async () => {
    role = 'cashier';
    for (const say of ['received 10 rice from Dangote at 41000 each', 'pay Dangote 1000', 'how much do I owe', 'transfer 5 rice to Ikeja branch', 'transfer arrived']) {
      expect((await agent.handle(say)).text).toMatch(/not allowed/);
    }
    expect(await db.purchases.count()).toBe(0);
    expect((await agent.handle('how many rice do I have')).text).toMatch(/20/); // still allowed
  });
  it('respects the feature switches in Settings', async () => {
    config.features.purchases = false; config.features.transfers = false;
    expect((await agent.handle('received 10 rice from Dangote at 41000 each')).text).toMatch(/switched off/);
    expect((await agent.handle('transfer 5 rice to Ikeja branch')).text).toMatch(/switched off/);
    expect((await agent.handle('how much do I owe')).text).toMatch(/switched off/);
  });
});
