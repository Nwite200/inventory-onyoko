// Quotations, sales orders, customer payments/statements and the credit ledger.
import { db, uid, type CustomerPayment, type Sale, type SaleDocument } from './db';
import { queueAdvanced } from './advanced';
import { checkout } from './actions';
import { dayStamp, deviceCode } from './numbering';
import { computeSaleTotals } from './tax';
import { currentLocationId } from './location';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const creditPortion = (sale: Sale): number =>
  sale.payments?.filter((p) => p.method === 'credit').reduce((s, p) => s + p.amount, 0) ?? (sale.payment === 'credit' ? sale.total : 0);

export async function createDocument(input: {
  type: 'quote' | 'order';
  customerName: string;
  items: { productId: string; qty: number; price?: number }[];
  discount?: number;
  validUntil?: number;
  note?: string;
}): Promise<SaleDocument> {
  const customerName = input.customerName.trim();
  if (!customerName) throw new Error('Choose a customer');
  if (input.items.length === 0) throw new Error('Add at least one item');
  const taxRates = await db.taxRates.toArray();
  const items = [];
  for (const it of input.items) {
    if (!(it.qty > 0)) throw new Error('Quantity must be more than zero');
    const product = await db.products.get(it.productId);
    if (!product) throw new Error('A product no longer exists');
    items.push({ productId: product.id, name: product.name, qty: it.qty, price: it.price ?? product.price, ...(product.taxRateId ? { taxRateId: product.taxRateId } : {}) });
  }
  const totals = computeSaleTotals(items, input.discount ?? 0, taxRates);
  const at = Date.now();
  const kind = input.type === 'quote' ? 'QUO' : 'SO';
  const prefix = `${kind}-${dayStamp(at)}-${deviceCode()}-`;
  const made = (await db.saleDocuments.toArray()).filter((d) => d.number.startsWith(prefix)).length;
  const record: SaleDocument = {
    id: uid(),
    number: `${prefix}${String(made + 1).padStart(4, '0')}`,
    type: input.type,
    at,
    customerName,
    items,
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total,
    status: 'draft',
    locationId: currentLocationId(),
    ...(input.validUntil ? { validUntil: input.validUntil } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
  await db.transaction('rw', [db.saleDocuments, db.outbox], async () => {
    await db.saleDocuments.add(record);
    await queueAdvanced('saleDocuments', record);
  });
  return record;
}

export async function setDocumentStatus(id: string, status: SaleDocument['status']): Promise<SaleDocument> {
  const doc = await db.saleDocuments.get(id);
  if (!doc) throw new Error('Document not found');
  if (doc.status === 'converted') throw new Error('A converted document cannot change');
  const next = { ...doc, status };
  await db.transaction('rw', [db.saleDocuments, db.outbox], async () => {
    await db.saleDocuments.put(next);
    await queueAdvanced('saleDocuments', next);
  });
  return next;
}

/** Converts a quote/order into a real sale; stock moves only now. */
export async function convertDocument(id: string, payment = 'cash', cashier?: string, serialsByProduct: Record<string, string[]> = {}): Promise<{ document: SaleDocument; sale: Sale }> {
  const doc = await db.saleDocuments.get(id);
  if (!doc) throw new Error('Document not found');
  if (doc.status === 'converted') throw new Error('This document is already a sale');
  if (doc.status === 'cancelled') throw new Error('This document was cancelled');
  const sale = await checkout({
    items: doc.items.map((it) => ({
      productId: it.productId,
      qty: it.qty,
      price: it.price,
      ...(it.taxRateId ? { taxRateId: it.taxRateId } : {}),
      ...(serialsByProduct[it.productId]?.length ? { serials: serialsByProduct[it.productId] } : {}),
    })),
    customerName: doc.customerName,
    payment,
    discount: doc.discount,
    cashier,
    documentId: doc.id,
    note: doc.number,
  });
  const next: SaleDocument = { ...doc, status: 'converted', saleId: sale.id };
  await db.transaction('rw', [db.saleDocuments, db.outbox], async () => {
    await db.saleDocuments.put(next);
    await queueAdvanced('saleDocuments', next);
  });
  return { document: next, sale };
}

// ---------------------------------------------------------------------------------------------
// Customer credit account

export interface StatementRow {
  at: number;
  kind: 'invoice' | 'refund' | 'payment';
  ref: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface CustomerStatement {
  customerName: string;
  rows: StatementRow[];
  outstanding: number;
  invoiced: number;
  refunded: number;
  paid: number;
}

export async function customerStatement(customerIdOrName: string): Promise<CustomerStatement> {
  const customer = await db.customers.get(customerIdOrName);
  const customerName = customer?.name ?? customerIdOrName;
  const lower = customerName.toLowerCase();
  const [sales, returns, payments] = await Promise.all([db.sales.toArray(), db.returns.toArray(), db.customerPayments.toArray()]);
  const mySales = sales.filter((s) => s.status === 'completed' && s.customerName.toLowerCase() === lower && creditPortion(s) > 0);
  const ids = new Set(mySales.map((s) => s.id));
  const myReturns = returns.filter((r) => r.status === 'completed' && r.paymentMethod === 'credit' && r.saleId && ids.has(r.saleId));
  const myPayments = payments.filter((p) => (customer && p.customerId === customer.id) || p.customerName.toLowerCase() === lower);

  const raw: Omit<StatementRow, 'balance'>[] = [
    ...mySales.map((s) => ({ at: s.at, kind: 'invoice' as const, ref: s.number, description: `Credit invoice${s.documentId ? ' (from order)' : ''}`, debit: creditPortion(s), credit: 0 })),
    ...myReturns.map((r) => ({ at: r.at, kind: 'refund' as const, ref: r.number, description: `Credit note for ${r.saleNumber}`, debit: 0, credit: r.totalRefunded })),
    ...myPayments.map((p) => ({ at: p.at, kind: 'payment' as const, ref: p.number, description: `Payment received (${p.method})`, debit: 0, credit: p.amount })),
  ].sort((a, b) => a.at - b.at);

  let balance = 0;
  const rows = raw.map((r) => {
    balance = round2(balance + r.debit - r.credit);
    return { ...r, balance };
  });
  const invoiced = round2(raw.reduce((s, r) => s + r.debit, 0));
  const refunded = round2(raw.reduce((s, r) => s + r.credit, 0));
  return { customerName, rows, outstanding: balance, invoiced, refunded, paid: round2(myPayments.reduce((s, p) => s + p.amount, 0)) };
}

export async function recordCustomerPayment(input: {
  customerId?: string;
  customerName: string;
  amount: number;
  method?: string;
  reference?: string;
  at?: number;
}): Promise<CustomerPayment> {
  const customerName = input.customerName.trim();
  if (!customerName) throw new Error('Choose a customer');
  if (!(input.amount > 0)) throw new Error('Amount must be more than zero');
  const customer = input.customerId ? await db.customers.get(input.customerId) : (await db.customers.toArray()).find((c) => c.name.toLowerCase() === customerName.toLowerCase());
  const statement = await customerStatement(customer?.id ?? customerName);
  if (input.amount > statement.outstanding + 0.005) throw new Error(`Only ${statement.outstanding} is outstanding for ${customerName}`);
  const at = input.at ?? Date.now();
  const id = uid();
  const already = new Map<string, number>();
  for (const p of await db.customerPayments.toArray()) for (const a of p.allocations) already.set(a.saleId, (already.get(a.saleId) ?? 0) + a.amount);
  const sales = (await db.sales.toArray())
    .filter((s) => s.status === 'completed' && s.customerName.toLowerCase() === customerName.toLowerCase() && creditPortion(s) > 0)
    .sort((a, b) => a.at - b.at);
  let left = input.amount;
  const allocations = [];
  for (const sale of sales) {
    if (left <= 0) break;
    const open = round2(creditPortion(sale) - (already.get(sale.id) ?? 0));
    if (open <= 0) continue;
    const take = round2(Math.min(open, left));
    allocations.push({ saleId: sale.id, amount: take });
    left = round2(left - take);
  }
  const record: CustomerPayment = {
    id,
    number: `CP-${dayStamp(at)}-${deviceCode()}-${String((await db.customerPayments.count()) + 1).padStart(4, '0')}`,
    ...(customer ? { customerId: customer.id } : {}),
    customerName,
    amount: round2(input.amount),
    method: input.method ?? 'cash',
    at,
    allocations,
    locationId: currentLocationId(),
    ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
  };
  await db.transaction('rw', [db.customerPayments, db.outbox], async () => {
    await db.customerPayments.add(record);
    await queueAdvanced('customerPayments', record);
  });
  return record;
}
