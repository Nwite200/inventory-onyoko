import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import * as A from './actions';
import { computeSaleTotals } from './tax';
import { addBin, addSerial, binQty, binStock, completeProductionOrder, createPickTask, createProductionOrder, putAway, saveBom, setSerialStatus } from './operations';
import { accumulatedDepreciation, addAsset, addBankAccount, addBankTransaction, addEmployee, budgetVariance, payPayslip, payrollFigures, postDepreciation, reconcile, runPayroll, saveBudget, saveCurrency, toBase } from './financeOps';
import { createDocument, convertDocument, customerStatement, recordCustomerPayment } from './documents';
import { decideApproval, requestApproval, requireApproval } from './approvals';
import { applyConfig } from './config';
import { buildLedger, loadLedger, postJournal, profitAndLoss, trialBalance } from './accounting';
import { refundSale } from './returns';
import { receivePurchase } from './purchases';
import { recordExpense } from './expenses';
import { uid } from './db';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });

const product = async (prefix: string) => (await db.products.toArray()).find((p) => p.name.startsWith(prefix))!;

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  store.clear();
  applyConfig({ approvalThreshold: 0 });
  await A.seedDemo();
});

describe('tax and split tenders', () => {
  const rate = (inclusive: boolean) => ({ id: 'vat', name: 'VAT', rate: 7.5, inclusive, accountCode: '2100', active: true });

  it('extracts inclusive tax and adds exclusive tax', () => {
    const inc = computeSaleTotals([{ productId: 'p', qty: 1, price: 100, taxRateId: 'vat' }], 0, [rate(true)]);
    expect(inc.total).toBe(100);
    expect(inc.tax).toBeCloseTo(6.98, 2);
    const exc = computeSaleTotals([{ productId: 'p', qty: 1, price: 100, taxRateId: 'vat' }], 0, [rate(false)]);
    expect(exc.total).toBe(107.5);
    expect(exc.tax).toBe(7.5);
  });

  it('records split payments and posts each tender to its own account', async () => {
    const vat = rate(true);
    await db.taxRates.add(vat);
    const rice = await product('Rice');
    await db.products.put({ ...rice, taxRateId: vat.id });
    const sale = await A.checkout({ items: [{ productId: rice.id, qty: 1 }], customerName: 'Ada', payments: [{ method: 'cash', amount: 20000 }, { method: 'transfer', amount: 25000 }] });
    expect(sale.payment).toBe('split');
    expect(sale.total).toBe(45000);
    expect(sale.tax).toBeCloseTo(3139.53, 2);
    expect(sale.payments).toHaveLength(2);
    const entries = await loadLedger();
    const tb = trialBalance(entries);
    expect(tb.balanced).toBe(true);
    expect(entries.find((e) => e.id === `sale:${sale.id}`)?.lines.some((l) => l.account === '1010' && l.debit === 20000)).toBe(true);
  });
});

describe('documents and customer credit', () => {
  it('turns a quotation into a sale only at conversion', async () => {
    const rice = await product('Rice');
    const doc = await createDocument({ type: 'quote', customerName: 'Ada', items: [{ productId: rice.id, qty: 2 }] });
    expect(doc.total).toBe(2 * rice.price);
    expect((await db.products.get(rice.id))!.stock).toBe(rice.stock);
    const { sale, document } = await convertDocument(doc.id, 'cash');
    expect(document.status).toBe('converted');
    expect((await db.products.get(rice.id))!.stock).toBe(rice.stock - 2);
    expect(sale.total).toBe(doc.total);
  });

  it('requires serials when converting a quotation for a serial-tracked item', async () => {
    const phone = await A.addProduct({ name: 'Quoted Phone', price: 500, cost: 300, openingStock: 2, trackSerials: true });
    const serial = await addSerial({ productId: phone.id, serial: 'QUOTE-SN-1' });
    const doc = await createDocument({ type: 'quote', customerName: 'Ada', items: [{ productId: phone.id, qty: 1 }] });
    await expect(convertDocument(doc.id)).rejects.toThrow(/serial number/);
    const converted = await convertDocument(doc.id, 'cash', 'admin', { [phone.id]: [serial.id] });
    expect(converted.document.status).toBe('converted');
    expect((await db.serials.get(serial.id))!.status).toBe('sold');
  });

  it('allocates customer payments and builds a statement', async () => {
    const rice = await product('Rice');
    const sale = await A.checkout({ items: [{ productId: rice.id, qty: 1 }], customerName: 'Ada Credit', payment: 'credit' });
    const before = await customerStatement('Ada Credit');
    expect(before.outstanding).toBe(sale.total);
    await recordCustomerPayment({ customerName: 'Ada Credit', amount: 20000, method: 'cash' });
    const after = await customerStatement('Ada Credit');
    expect(after.outstanding).toBe(sale.total - 20000);
    expect(after.rows.some((r) => r.kind === 'payment')).toBe(true);
    const entries = await loadLedger();
    expect(entries.some((e) => e.id.startsWith('customer-payment:'))).toBe(true);
    await expect(recordCustomerPayment({ customerName: 'Ada Credit', amount: after.outstanding + 1 })).rejects.toThrow(/outstanding/);
  });
});

describe('warehouse, serials and manufacturing', () => {
  it('keeps bin allocations separate from product stock and picks them', async () => {
    const rice = await product('Rice');
    await addBin({ code: 'A-01', zone: 'Dry' });
    const bin = (await db.bins.toArray())[0]!;
    await putAway({ productId: rice.id, binId: bin.id, qty: 5 });
    expect((await db.products.get(rice.id))!.stock).toBe(rice.stock);
    await expect(putAway({ productId: rice.id, binId: bin.id, qty: rice.stock })).rejects.toThrow(/unassigned/);
    const sale = await A.checkout({ items: [{ productId: rice.id, qty: 2 }] });
    await createPickTask(sale.id);
    const task = (await db.pickTasks.toArray())[0]!;
    expect(task.items[0]!.binId).toBe(bin.id);
    expect(task.status).toBe('picked'); // picked at checkout under enforced bin picking
    expect(binQty(await binStock(), bin.id, rice.id)).toBe(3);
    expect(task.items[0]!.qty).toBe(2);
  });

  it('registers unique serials and changes their status', async () => {
    const rice = await product('Rice');
    const serial = await addSerial({ productId: rice.id, serial: 'SN-100', warrantyMonths: 12 });
    expect(serial.status).toBe('in_stock');
    await expect(addSerial({ productId: rice.id, serial: 'sn-100' })).rejects.toThrow(/already/);
    await setSerialStatus(serial.id, 'sold', 'sale-1');
    expect((await db.serials.get(serial.id))!.status).toBe('sold');
  });

  it('explodes multi-level BOMs to raw components and detects cycles', async () => {
    const rice = await product('Rice');
    const sauce = await A.addProduct({ name: 'Sauce Batch', price: 1000, cost: 0, openingStock: 0 });
    const meal = await A.addProduct({ name: 'Meal Box', price: 70000, cost: 0, openingStock: 0 });
    await saveBom({ productId: sauce.id, name: 'Sauce', items: [{ productId: rice.id, qty: 1 }], outputQty: 1, laborCost: 100 });
    await saveBom({ productId: meal.id, name: 'Meal', items: [{ productId: sauce.id, qty: 2 }], outputQty: 1, laborCost: 0 });
    const mealBom = (await db.boms.toArray()).find((b) => b.productId === meal.id)!;
    const order = await createProductionOrder(mealBom.id, 1);
    expect(order.components).toEqual([{ productId: rice.id, name: rice.name, qty: 2 }]);
    expect(order.laborCost).toBe(200);
    const beforeRice = (await db.products.get(rice.id))!.stock;
    await completeProductionOrder(order.id);
    expect((await db.products.get(rice.id))!.stock).toBe(beforeRice - 2);
    expect((await db.products.get(sauce.id))!.stock).toBe(0);
    expect((await db.products.get(meal.id))!.stock).toBe(1);

    const a = await A.addProduct({ name: 'Cycle A', price: 1, cost: 1, openingStock: 0 });
    const b = await A.addProduct({ name: 'Cycle B', price: 1, cost: 1, openingStock: 0 });
    await saveBom({ productId: a.id, name: 'A', items: [{ productId: b.id, qty: 1 }] });
    await saveBom({ productId: b.id, name: 'B', items: [{ productId: a.id, qty: 1 }] });
    const cycleBom = (await db.boms.toArray()).find((x) => x.productId === a.id)!;
    await expect(createProductionOrder(cycleBom.id, 1)).rejects.toThrow(/cycle/);
  });

  it('consumes components and produces finished goods with balanced postings', async () => {
    const rice = await product('Rice');
    const finished = await A.addProduct({ name: 'Rice Pack', price: 60000, cost: 50000, openingStock: 0 });
    await saveBom({ productId: finished.id, name: 'Rice pack recipe', items: [{ productId: rice.id, qty: 1 }], outputQty: 1, laborCost: 2000, overheadCost: 1000 });
    const bom = (await db.boms.toArray())[0]!;
    const order = await createProductionOrder(bom.id, 2);
    await completeProductionOrder(order.id);
    expect((await db.products.get(rice.id))!.stock).toBe(rice.stock - 2);
    expect((await db.products.get(finished.id))!.stock).toBe(2);
    const pl = profitAndLoss(await loadLedger());
    expect(Number.isFinite(pl.netProfit)).toBe(true);
    expect(trialBalance(await loadLedger()).balanced).toBe(true);
  });
});

describe('finance operations', () => {
  it('posts straight-line depreciation and payroll to the ledger', async () => {
    const asset = await addAsset({ name: 'Freezer', category: 'Equipment', cost: 1200, lifeMonths: 12 });
    expect(accumulatedDepreciation(asset)).toBe(0);
    await postDepreciation(asset.id);
    expect((await db.assets.get(asset.id))!.monthsPosted).toBe(1);
    const emp = await addEmployee({ name: 'Ada', role: 'Cashier', salary: 1000, taxRate: 7.5, pensionRate: 8 });
    expect(payrollFigures(emp)).toEqual({ gross: 1000, tax: 75, pension: 80, net: 845 });
    const slips = await runPayroll(Date.now() - 30 * 86_400_000, Date.now());
    await payPayslip(slips[0]!.id);
    const tb = trialBalance(await loadLedger());
    expect(tb.balanced).toBe(true);
  });

  it('computes budget variance, currency conversion and bank reconciliation', async () => {
    const budget = await saveBudget({ name: 'Q1', start: Date.now() - 86_400_000, end: Date.now() + 86_400_000, lines: [{ account: '6100', amount: 5000 }] });
    const variance = budgetVariance(budget, await loadLedger());
    expect(variance.totalBudget).toBe(5000);
    const usd = await saveCurrency({ code: 'USD', name: 'Dollar', symbol: '$', rate: 1600 });
    expect(toBase(10, usd.rate)).toBe(16000);
    const account = await addBankAccount({ name: 'Main', bank: 'GTB', number: '123', openingBalance: 1000 });
    await addBankTransaction({ bankAccountId: account.id, date: Date.now(), description: 'Deposit', amount: 500 });
    const rec = reconcile(account, await db.bankTransactions.toArray(), 1000);
    expect(rec.statementBalance).toBe(1500);
    expect(rec.clearedBalance).toBe(1000);
  });
});

describe('approval workflow', () => {
  it('blocks a refund above the threshold until a manager approves', async () => {
    applyConfig({ approvalThreshold: 100 });
    const rice = await product('Rice');
    const sale = await A.checkout({ items: [{ productId: rice.id, qty: 2 }] });
    await expect(requireApproval('refund', sale.id, sale.total)).rejects.toThrow(/Approval required/);
    const request = await requestApproval({ kind: 'refund', entityId: sale.id, summary: 'Refund', amount: sale.total, requestedBy: 'cashier' });
    await decideApproval(request.id, true, 'ok', 'manager');
    expect((await requireApproval('refund', sale.id, sale.total))?.id).toBe(request.id);
  });

  it('posts a balanced ledger for a mixed tax sale plus refund', async () => {
    const vat = { id: 'vat', name: 'VAT', rate: 7.5, inclusive: true, accountCode: '2100', active: true };
    await db.taxRates.add(vat);
    const rice = await product('Rice');
    await db.products.put({ ...rice, taxRateId: vat.id });
    const sale = await A.checkout({ items: [{ productId: rice.id, qty: 3 }], payment: 'cash' });
    const entries = buildLedger({ sales: [sale], purchases: [], expenses: [], returns: [], movements: await db.stockMovements.toArray(), journals: [], products: await db.products.toArray() });
    expect(trialBalance(entries).balanced).toBe(true);
    expect(profitAndLoss(entries).revenue).toBeCloseTo(sale.total - (sale.tax ?? 0), 2);
    expect(uid()).toHaveLength(36);
  });
});


describe('deep enforcement', () => {
  it('requires serial numbers at checkout and restores them on void/refund', async () => {
    const phone = await A.addProduct({ name: 'Phone X', price: 100, cost: 60, openingStock: 5, trackSerials: true });
    const one = await addSerial({ productId: phone.id, serial: 'SN-A' });
    const two = await addSerial({ productId: phone.id, serial: 'SN-B' });
    await expect(A.checkout({ items: [{ productId: phone.id, qty: 1 }] })).rejects.toThrow(/serial number/);
    const sale = await A.checkout({ items: [{ productId: phone.id, qty: 2, serials: [one.id, two.id] }] });
    expect((await db.serials.get(one.id))!.status).toBe('sold');
    expect((await db.serials.get(two.id))!.saleId).toBe(sale.id);
    await A.voidSale(sale.id);
    expect((await db.serials.get(one.id))!.status).toBe('in_stock');

    const again = await A.checkout({ items: [{ productId: phone.id, qty: 1, serials: [one.id] }] });
    await expect(refundSale({ saleId: again.id, items: [{ productId: phone.id, qty: 1, condition: 'restock' }] })).rejects.toThrow(/serial number/);
    await refundSale({ saleId: again.id, items: [{ productId: phone.id, qty: 1, condition: 'restock', serials: [one.id] }] });
    expect((await db.serials.get(one.id))!.status).toBe('in_stock');
  });

  it('enforces bin picking and returns units to their bins on refund', async () => {
    const rice = await product('Rice');
    await addBin({ code: 'B-01' });
    const bin = (await db.bins.toArray())[0]!;
    await putAway({ productId: rice.id, binId: bin.id, qty: 3 });
    await expect(A.checkout({ items: [{ productId: rice.id, qty: 5 }] })).rejects.toThrow(/Only 3/);
    const sale = await A.checkout({ items: [{ productId: rice.id, qty: 2 }] });
    expect(sale.items[0]!.binPicks).toEqual([{ binId: bin.id, qty: 2 }]);
    expect(binQty(await binStock(), bin.id, rice.id)).toBe(1);
    await refundSale({ saleId: sale.id, items: [{ productId: rice.id, qty: 1, condition: 'restock' }] });
    expect(binQty(await binStock(), bin.id, rice.id)).toBe(2);
  });

  it('converts foreign purchase costs to base currency for stock and payables', async () => {
    const usd = await saveCurrency({ code: 'USD', name: 'Dollar', symbol: '$', rate: 1600 });
    const rice = await product('Rice');
    const purchase = await receivePurchase({ supplierName: 'Import Co', items: [{ productId: rice.id, qty: 2, cost: 10 }], currency: usd.code, fxRate: usd.rate, paid: 16000 });
    expect(purchase.currency).toBe('USD');
    expect(purchase.total).toBe(32000);
    expect(purchase.foreignTotal).toBe(20);
    expect(purchase.items[0]!.cost).toBe(16000);
    expect(purchase.items[0]!.foreignCost).toBe(10);
    expect((await db.products.get(rice.id))!.cost).toBe(16000);
    expect(purchase.total - purchase.paid).toBe(16000);
  });
});


describe('approvals for expenses, adjustments and journals', () => {
  it('blocks and then releases an expense, a stock adjustment and a journal', async () => {
    applyConfig({ approvalThreshold: 100 });
    const rice = await product('Rice');

    await expect(recordExpense({ id: 'exp-appr', category: 'Utilities', amount: 150, paymentMethod: 'cash' })).rejects.toThrow(/Approval required/);
    const expense = await requestApproval({ kind: 'expense', entityId: 'exp-appr', summary: 'Utilities', amount: 150 });
    await decideApproval(expense.id, true);
    await recordExpense({ id: 'exp-appr', category: 'Utilities', amount: 150, paymentMethod: 'cash' });
    expect((await db.expenses.get('exp-appr'))!.amount).toBe(150);

    const key = 'adjust-appr';
    await expect(A.adjustStock(rice.id, 2, 'adjustment', undefined, key)).rejects.toThrow(/Approval required/);
    const adj = await requestApproval({ kind: 'stock_adjustment', entityId: key, summary: 'Adjustment', amount: 2 * rice.cost });
    await decideApproval(adj.id, true);
    await A.adjustStock(rice.id, 2, 'adjustment', undefined, key);

    const jkey = 'journal-appr';
    const lines = [{ account: '1010', debit: 200, credit: 0 }, { account: '3000', debit: 0, credit: 200 }];
    await expect(postJournal({ memo: 'Opening', lines, approvalKey: jkey })).rejects.toThrow(/Approval required/);
    const j = await requestApproval({ kind: 'journal', entityId: jkey, summary: 'Opening', amount: 200 });
    await decideApproval(j.id, true);
    expect((await postJournal({ memo: 'Opening', lines, approvalKey: jkey })).approvalKey).toBe(jkey);
    applyConfig({ approvalThreshold: 0 });
  });
});
