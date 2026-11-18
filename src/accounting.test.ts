import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Expense, JournalLine, Product, Purchase, Sale, SaleReturn, StockMovement } from './db';
import { db } from './db';
import {
  balanceSheet,
  buildLedger,
  journalTotals,
  postJournal,
  profitAndLoss,
  reverseJournal,
  trialBalance,
  validateJournal,
  type LedgerSources,
} from './accounting';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });

const AT = Date.UTC(2026, 4, 12, 12, 0, 0);

const product: Product = {
  id: 'p1',
  name: 'Rice bag',
  sku: '1001',
  aliases: [],
  price: 120,
  cost: 70,
  unit: 'bag',
  stock: 0,
  lowStockAt: 2,
  updatedAt: AT,
};

const sale: Sale = {
  id: 's1',
  number: 'INV-1',
  at: AT,
  customerName: 'Ada',
  payment: 'cash',
  items: [{ productId: 'p1', name: 'Rice bag', qty: 2, price: 120, cost: 70 }],
  subtotal: 240,
  discount: 0,
  total: 240,
  status: 'completed',
  locationId: 'main',
};

const purchase: Purchase = {
  id: 'pur1',
  number: 'PO-1',
  at: AT + 1000,
  supplierId: 'sup1',
  supplierName: 'Dangote',
  items: [{ productId: 'p1', name: 'Rice bag', qty: 3, cost: 100 }],
  total: 300,
  paid: 100,
  payments: [{ id: 'pay1', amount: 100, at: AT + 1000 }],
  status: 'received',
  locationId: 'main',
};

const expense: Expense = {
  id: 'e1',
  category: 'Utilities (Electricity/Water)',
  amount: 50,
  paymentMethod: 'cash',
  at: AT + 2000,
  locationId: 'main',
};

const refund: SaleReturn = {
  id: 'r1',
  number: 'RET-1',
  saleId: 's1',
  saleNumber: 'INV-1',
  at: AT + 3000,
  customerName: 'Ada',
  items: [{ productId: 'p1', name: 'Rice bag', qty: 1, unitPrice: 120, refundAmount: 120, condition: 'restock' }],
  totalRefunded: 120,
  paymentMethod: 'cash',
  locationId: 'main',
  status: 'completed',
};

const opening: StockMovement = { id: 'm0', productId: 'p1', delta: 10, reason: 'opening', at: AT - 5000, locationId: 'main' };

const sources = (over: Partial<LedgerSources> = {}): LedgerSources => ({
  sales: [sale],
  purchases: [purchase],
  expenses: [expense],
  returns: [refund],
  movements: [opening],
  journals: [],
  products: [product],
  ...over,
});

const everyEntryBalanced = (entries: ReturnType<typeof buildLedger>): boolean =>
  entries.every((e) => {
    const t = journalTotals(e.lines);
    return t.balanced;
  });

describe('derived double-entry ledger', () => {
  it('posts balanced entries for opening stock, sales, purchases, expenses and refunds', () => {
    const entries = buildLedger(sources());
    expect(entries.length).toBe(6); // opening, sale, purchase, supplier payment, expense, refund
    expect(everyEntryBalanced(entries)).toBe(true);
    const tb = trialBalance(entries);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBeCloseTo(tb.totalCredit, 2);
  });

  it('captures cost at sale time, so later cost changes do not rewrite profit', () => {
    const laterCost = { ...product, cost: 999 };
    const entries = buildLedger(sources({ products: [laterCost], returns: [], purchases: [], expenses: [] }));
    const pl = profitAndLoss(entries);
    expect(pl.cogs).toBe(140); // 2 bags at the captured cost, not the new catalogue cost
  });

  it('produces a profit and loss statement with discounts already netted', () => {
    const discounted: Sale = { ...sale, subtotal: 240, discount: 40, total: 200 };
    const entries = buildLedger(sources({ sales: [discounted] }));
    const pl = profitAndLoss(entries);
    expect(pl.revenue).toBe(200);
    expect(pl.returns).toBe(120);
    expect(pl.netRevenue).toBe(80);
    expect(pl.cogs).toBe(70);
    expect(pl.grossProfit).toBe(10);
    expect(pl.expenses).toBe(50);
    expect(pl.netProfit).toBe(-40);
  });

  it('balances the balance sheet to the cent', () => {
    const entries = buildLedger(sources());
    const bs = balanceSheet(entries, AT + 10_000);
    expect(bs.totalAssets).toBeCloseTo(900, 2); // cash -30 + inventory 930
    expect(bs.totalLiabilities).toBeCloseTo(200, 2);
    expect(bs.totalEquity).toBeCloseTo(700, 2);
    expect(bs.earnings).toBeCloseTo(0, 2);
    expect(bs.difference).toBeCloseTo(0, 2);
  });

  it('posts stock losses to inventory adjustments, never silently', () => {
    const loss: StockMovement = { id: 'adj1', productId: 'p1', delta: -1, reason: 'adjustment:damaged', at: AT + 4000, locationId: 'main' };
    const entries = buildLedger(sources({ movements: [opening, loss] }));
    const pl = profitAndLoss(entries);
    expect(pl.inventoryAdjustments).toBe(70);
    expect(entries.find((e) => e.id === 'stock:adj1')?.lines).toEqual([
      { account: '5150', debit: 70, credit: 0, memo: 'Inventory adjustment' },
      { account: '1200', debit: 0, credit: 70, memo: 'Stock loss' },
    ]);
  });
});

describe('journal validation and manual posting', () => {
  const good: JournalLine[] = [
    { account: '1010', debit: 100, credit: 0 },
    { account: '3000', debit: 0, credit: 100 },
  ];

  it('rejects unbalanced, two-sided and unknown-account lines', () => {
    expect(validateJournal([{ account: '1010', debit: 100, credit: 0 }, { account: '3000', debit: 0, credit: 90 }])).toMatch(/match/);
    expect(validateJournal([{ account: '1010', debit: 100, credit: 100 }, { account: '3000', debit: 0, credit: 0 }])).toBeTruthy();
    expect(validateJournal([{ account: '9999', debit: 100, credit: 0 }, { account: '3000', debit: 0, credit: 100 }])).toMatch(/Unknown/);
    expect(validateJournal(good)).toBeNull();
  });

  beforeEach(async () => {
    for (const t of db.tables) await t.clear();
    store.clear();
  });

  it('posts a balanced journal and refuses an unbalanced one', async () => {
    await expect(postJournal({ memo: 'bad', lines: [{ account: '1010', debit: 10, credit: 0 }, { account: '3000', debit: 0, credit: 9 }] })).rejects.toThrow(/match/);
    const entry = await postJournal({ memo: 'Owner capital', lines: good, date: AT, createdBy: 'ada' });
    expect(entry.number).toMatch(/^JE-\d{8}-001$/);
    expect(entry.createdBy).toBe('ada');
    expect(await db.journals.count()).toBe(1);
    const tb = trialBalance(buildLedger({ sales: [], purchases: [], expenses: [], returns: [], movements: [], journals: await db.journals.toArray(), products: [] }));
    expect(tb.balanced).toBe(true);
  });

  it('reverses with an opposite entry and never edits the original', async () => {
    const original = await postJournal({ memo: 'Accrual', lines: good, date: AT });
    const rev = await reverseJournal(original.id, 'manager');
    expect(rev.reverses).toBe(original.id);
    expect(journalTotals(rev.lines)).toEqual({ debit: 100, credit: 100, balanced: true });
    const rows = await db.journals.toArray();
    expect(rows).toHaveLength(2);
    expect((await db.journals.get(original.id))?.lines).toEqual(good);
    await expect(reverseJournal(original.id)).rejects.toThrow(/already been reversed/);
  });
});
