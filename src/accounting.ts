// Double-entry accounting.
//
// Two kinds of entries exist:
//  1. Derived entries, computed deterministically from sales, purchases, payments, expenses,
//     returns and stock adjustments. They cannot drift from operations because they are rebuilt
//     from the same records every time.
//  2. Manual journals, stored in `db.journals`. Posted manuals are immutable; a correction is a
//     reversal entry, never an edit.
//
// Every entry added here is balanced. The statements treat a debit balance as positive for
// assets/expenses and a credit balance as positive for liabilities/equity/income.
import { db, type Expense, type JournalEntry, type JournalLine, type Product, type Purchase, type Sale, type SaleReturn, type StockMovement, type CustomerPayment, type Payslip, type ProductionOrder } from './db';
import { uid } from './db';
import { queue } from './actions';
import { getSession } from './auth';
import { requireApproval } from './approvals';

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface Account {
  code: string;
  name: string;
  type: AccountType;
  group: string;
}

export const CHART_OF_ACCOUNTS: Account[] = [
  { code: '1010', name: 'Cash on hand', type: 'asset', group: 'Current assets' },
  { code: '1020', name: 'Bank & card settlements', type: 'asset', group: 'Current assets' },
  { code: '1110', name: 'Accounts receivable', type: 'asset', group: 'Current assets' },
  { code: '1200', name: 'Inventory', type: 'asset', group: 'Current assets' },
  { code: '1250', name: 'Work in progress', type: 'asset', group: 'Current assets' },
  { code: '1500', name: 'Fixed assets', type: 'asset', group: 'Non-current assets' },
  { code: '1510', name: 'Accumulated depreciation', type: 'asset', group: 'Non-current assets' },
  { code: '2000', name: 'Accounts payable', type: 'liability', group: 'Current liabilities' },
  { code: '2100', name: 'Tax payable', type: 'liability', group: 'Current liabilities' },
  { code: '3000', name: "Owner's equity", type: 'equity', group: 'Equity' },
  { code: '3100', name: 'Opening balance equity', type: 'equity', group: 'Equity' },
  { code: '3900', name: 'Retained earnings', type: 'equity', group: 'Equity' },
  { code: '4000', name: 'Sales revenue', type: 'income', group: 'Revenue' },
  { code: '4100', name: 'Sales returns & refunds', type: 'income', group: 'Revenue' },
  { code: '4200', name: 'Other income', type: 'income', group: 'Revenue' },
  { code: '5000', name: 'Cost of goods sold', type: 'expense', group: 'Cost of sales' },
  { code: '5150', name: 'Inventory adjustments', type: 'expense', group: 'Cost of sales' },
  { code: '6100', name: 'Operating expenses', type: 'expense', group: 'Operating expenses' },
  { code: '6200', name: 'Utilities', type: 'expense', group: 'Operating expenses' },
  { code: '6300', name: 'Rent & lease', type: 'expense', group: 'Operating expenses' },
  { code: '6400', name: 'Salaries & wages', type: 'expense', group: 'Operating expenses' },
  { code: '6500', name: 'Repairs & maintenance', type: 'expense', group: 'Operating expenses' },
  { code: '6600', name: 'Logistics & transport', type: 'expense', group: 'Operating expenses' },
  { code: '6700', name: 'Packaging & supplies', type: 'expense', group: 'Operating expenses' },
  { code: '6800', name: 'Marketing', type: 'expense', group: 'Operating expenses' },
  { code: '6900', name: 'Taxes & licences', type: 'expense', group: 'Operating expenses' },
  { code: '6950', name: 'Miscellaneous', type: 'expense', group: 'Operating expenses' },
  { code: '7000', name: 'Cash shortages', type: 'expense', group: 'Operating expenses' },
  { code: '7100', name: 'Depreciation', type: 'expense', group: 'Operating expenses' },
];

const ACCOUNT = new Map(CHART_OF_ACCOUNTS.map((a) => [a.code, a]));
export const accountName = (code: string): string => ACCOUNT.get(code)?.name ?? code;
export const accountType = (code: string): AccountType => ACCOUNT.get(code)?.type ?? 'expense';

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const paymentAccount = (method: string): string => {
  if (method === 'credit') return '1110';
  if (method === 'cash') return '1010';
  return '1020';
};

export function expenseAccount(category: string): string {
  const c = category.toLowerCase();
  if (/utilit|electric|water/.test(c)) return '6200';
  if (/rent|lease|accommodation/.test(c)) return '6300';
  if (/salar|wage|payroll|staff/.test(c)) return '6400';
  if (/repair|maintenance/.test(c)) return '6500';
  if (/logist|transport|delivery|fuel|freight/.test(c)) return '6600';
  if (/packag|supplies/.test(c)) return '6700';
  if (/market|advert|promotion/.test(c)) return '6800';
  if (/tax|licen|levy|inspection/.test(c)) return '6900';
  return '6100';
}

// ---------------------------------------------------------------------------------------------
// Journal validation and manual posting

export function journalTotals(lines: JournalLine[]): { debit: number; credit: number; balanced: boolean } {
  const debit = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const credit = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 && debit > 0 };
}

/** Returns a human-readable problem, or null when the journal may be posted. */
export function validateJournal(lines: JournalLine[]): string | null {
  if (lines.length < 2) return 'A journal needs at least two lines';
  for (const l of lines) {
    if (!ACCOUNT.has(l.account)) return `Unknown account ${l.account}`;
    const debit = Number(l.debit) || 0;
    const credit = Number(l.credit) || 0;
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) return 'Amounts must be zero or more';
    if (debit > 0 && credit > 0) return 'A line is either a debit or a credit, not both';
    if (debit === 0 && credit === 0) return 'Every line needs an amount';
  }
  const total = journalTotals(lines);
  if (!total.balanced) return `Debits and credits must match (${total.debit} vs ${total.credit})`;
  return null;
}

export async function postJournal(input: { date?: number; memo: string; lines: JournalLine[]; createdBy?: string; reverses?: string; approvalKey?: string }): Promise<JournalEntry> {
  const lines = input.lines
    .map((l) => ({ account: l.account, debit: round2(Number(l.debit) || 0), credit: round2(Number(l.credit) || 0), ...(l.memo?.trim() ? { memo: l.memo.trim() } : {}) }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);
  const problem = validateJournal(lines);
  if (problem) throw new Error(problem);
  const memo = input.memo.trim();
  if (!memo) throw new Error('Add a description for this journal');
  const date = input.date ?? Date.now();
  const total = journalTotals(lines).debit;
  const approvalKey = input.approvalKey ?? `journal:${date}:${memo}:${total}`;
  await requireApproval('journal', approvalKey, total);
  const day = new Date(date);
  const prefix = `JE-${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`;
  const sameDay = await db.journals.filter((j) => j.number.startsWith(prefix)).count();
  const entry: JournalEntry = {
    id: uid(),
    number: `${prefix}-${String(sameDay + 1).padStart(3, '0')}`,
    date,
    memo,
    lines,
    createdAt: Date.now(),
    approvalKey,
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    ...(input.reverses ? { reverses: input.reverses } : {}),
  };
  await db.transaction('rw', db.journals, db.outbox, async () => {
    await db.journals.add(entry);
    await queue('journal', 'create', entry);
  });
  return entry;
}

/** Reverses a posted journal with an equal and opposite entry. Nothing is edited or deleted. */
export async function reverseJournal(entryId: string, createdBy?: string): Promise<JournalEntry> {
  const original = await db.journals.get(entryId);
  if (!original) throw new Error('Journal not found');
  if (original.reverses) throw new Error('A reversal cannot be reversed');
  const already = await db.journals.filter((j) => j.reverses === entryId).count();
  if (already) throw new Error('This journal has already been reversed');
  return postJournal({
    memo: `Reversal of ${original.number} — ${original.memo}`,
    lines: original.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit, ...(l.memo ? { memo: l.memo } : {}) })),
    createdBy,
    reverses: entryId,
  });
}

// ---------------------------------------------------------------------------------------------
// Derived ledger

export type LedgerSource = 'sale' | 'purchase' | 'supplier payment' | 'expense' | 'refund' | 'stock' | 'manual';

export interface LedgerEntry {
  id: string;
  date: number;
  memo: string;
  ref: string;
  source: LedgerSource;
  lines: JournalLine[];
}

export interface LedgerSources {
  sales: Sale[];
  purchases: Purchase[];
  expenses: Expense[];
  returns: SaleReturn[];
  movements: StockMovement[];
  journals: JournalEntry[];
  products: Product[];
  customerPayments?: CustomerPayment[];
  payslips?: Payslip[];
  productionOrders?: ProductionOrder[];
}

const line = (account: string, debit: number, credit: number, memo?: string): JournalLine => ({
  account,
  debit: round2(debit),
  credit: round2(credit),
  ...(memo ? { memo } : {}),
});

export function buildLedger(src: LedgerSources): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  const cost = new Map(src.products.map((p) => [p.id, p.cost]));
  const costOf = (productId: string): number => cost.get(productId) ?? 0;

  for (const s of src.sales) {
    if (s.status !== 'completed' || !(s.total > 0)) continue;
    const tax = Math.min(s.total, Math.max(0, s.tax ?? 0));
    const tenders = s.payments?.length ? s.payments : [{ method: s.payment, amount: s.total }];
    const lines: JournalLine[] = [
      ...tenders.map((p) => line(paymentAccount(p.method), p.amount, 0, `${p.method} tender`)),
      line('4000', 0, round2(s.total - tax), 'Sale'),
      ...(tax > 0 ? [line('2100', 0, tax, 'Tax collected')] : []),
    ];
    const cogs = round2(s.items.reduce((sum, it) => sum + it.qty * (it.cost ?? costOf(it.productId)), 0));
    if (cogs > 0) {
      lines.push(line('5000', cogs, 0, 'Cost of goods sold'));
      lines.push(line('1200', 0, cogs, 'Inventory released'));
    }
    entries.push({ id: `sale:${s.id}`, date: s.at, memo: `Sale ${s.number} — ${s.customerName}`, ref: s.number, source: 'sale', lines });
  }

  for (const p of src.purchases) {
    if (p.status !== 'received' || !(p.total > 0)) continue;
    entries.push({
      id: `purchase:${p.id}`,
      date: p.at,
      memo: `Goods received ${p.number} — ${p.supplierName}`,
      ref: p.number,
      source: 'purchase',
      lines: [line('1200', p.total, 0, 'Inventory received'), line('2000', 0, p.total, 'Owed to supplier')],
    });
    for (const pay of p.payments) {
      if (!(pay.amount > 0)) continue;
      entries.push({
        id: `purchase:${p.id}:pay:${pay.id}`,
        date: pay.at,
        memo: `Payment to ${p.supplierName} for ${p.number}`,
        ref: p.number,
        source: 'supplier payment',
        lines: [line('2000', pay.amount, 0, 'Settle payable'), line('1010', 0, pay.amount, 'Cash paid')],
      });
    }
  }

  for (const e of src.expenses) {
    if (!(e.amount > 0)) continue;
    entries.push({
      id: `expense:${e.id}`,
      date: e.at,
      memo: `${e.category}${e.note ? ` — ${e.note}` : ''}`,
      ref: e.id.slice(0, 8),
      source: 'expense',
      lines: [line(expenseAccount(e.category), e.amount, 0, e.category), line(paymentAccount(e.paymentMethod), 0, e.amount, 'Paid')],
    });
  }

  for (const r of src.returns) {
    if (r.status !== 'completed' || !(r.totalRefunded > 0)) continue;
    const tax = Math.min(r.totalRefunded, Math.max(0, r.tax ?? 0));
    const lines: JournalLine[] = [
      line('4100', round2(r.totalRefunded - tax), 0, r.reason ?? 'Refund'),
      ...(tax > 0 ? [line('2100', tax, 0, 'Tax reversed')] : []),
      line(paymentAccount(r.paymentMethod), 0, r.totalRefunded, 'Refunded to customer'),
    ];
    for (const it of r.items) {
      if (it.condition !== 'restock') continue;
      const value = round2(it.qty * (it.cost ?? costOf(it.productId)));
      if (value > 0) {
        lines.push(line('1200', value, 0, 'Stock returned'));
        lines.push(line('5000', 0, value, 'COGS reversed'));
      }
    }
    entries.push({ id: `return:${r.id}`, date: r.at, memo: `Refund ${r.number} — ${r.saleNumber}`, ref: r.number, source: 'refund', lines });
  }

  const operational = new Set(['sale', 'void', 'purchase', 'purchase_void', 'transfer_out', 'transfer_in', 'return_restock', 'production_consume', 'production_output']);
  for (const m of src.movements) {
    if (operational.has(m.reason)) continue;
    const value = round2(Math.abs(m.delta) * costOf(m.productId));
    if (!(value > 0)) continue;
    if (m.reason === 'opening') {
      entries.push({
        id: `stock:${m.id}`,
        date: m.at,
        memo: `Opening stock — ${productName(src.products, m.productId)}`,
        ref: m.id.slice(0, 8),
        source: 'stock',
        lines: m.delta >= 0
          ? [line('1200', value, 0, 'Opening inventory'), line('3100', 0, value, 'Opening balance')]
          : [line('3100', value, 0, 'Opening balance'), line('1200', 0, value, 'Opening inventory')],
      });
      continue;
    }
    entries.push({
      id: `stock:${m.id}`,
      date: m.at,
      memo: `Stock ${m.reason.replace(/[:_]/g, ' ')} — ${productName(src.products, m.productId)}`,
      ref: m.ref ?? m.id.slice(0, 8),
      source: 'stock',
      lines: m.delta >= 0
        ? [line('1200', value, 0, 'Stock gain'), line('5150', 0, value, 'Inventory adjustment')]
        : [line('5150', value, 0, 'Inventory adjustment'), line('1200', 0, value, 'Stock loss')],
    });
  }

  for (const j of src.journals) {
    entries.push({ id: `journal:${j.id}`, date: j.date, memo: j.memo, ref: j.number, source: 'manual', lines: j.lines.map((l) => ({ ...l })) });
  }

  for (const p of src.customerPayments ?? []) {
    if (!(p.amount > 0)) continue;
    entries.push({
      id: `customer-payment:${p.id}`,
      date: p.at,
      memo: `Customer payment ${p.number} — ${p.customerName}`,
      ref: p.number,
      source: 'sale',
      lines: [line(paymentAccount(p.method), p.amount, 0, 'Payment received'), line('1110', 0, p.amount, 'Receivable settled')],
    });
  }

  for (const slip of src.payslips ?? []) {
    if (slip.status !== 'paid' || !(slip.gross > 0)) continue;
    const deductions = round2(slip.tax + slip.pension);
    entries.push({
      id: `payslip:${slip.id}`,
      date: slip.paidAt ?? slip.periodEnd,
      memo: `Payroll ${slip.number} — ${slip.employeeName}`,
      ref: slip.number,
      source: 'manual',
      lines: [
        line('6400', slip.gross, 0, 'Gross salary'),
        line('2100', 0, deductions, 'PAYE and pension'),
        line('1010', 0, slip.net, 'Net pay'),
      ],
    });
  }

  for (const order of src.productionOrders ?? []) {
    if (order.status !== 'completed' || !(order.unitCost > 0)) continue;
    const total = round2(order.unitCost * order.qty);
    const added = round2(order.laborCost + order.overheadCost);
    entries.push({
      id: `production:${order.id}`,
      date: order.completedAt ?? order.at,
      memo: `Production ${order.number} — ${order.name}`,
      ref: order.number,
      source: 'stock',
      lines: [
        line('1250', total, 0, 'Work in progress'),
        line('1200', 0, order.componentCost, 'Components consumed'),
        line('6950', 0, added, 'Labour and overhead applied'),
      ],
    });
    entries.push({
      id: `production-output:${order.id}`,
      date: order.completedAt ?? order.at,
      memo: `Finished goods ${order.number}`,
      ref: order.number,
      source: 'stock',
      lines: [line('1200', total, 0, 'Finished goods'), line('1250', 0, total, 'WIP released')],
    });
  }

  return entries.sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
}

function productName(products: Product[], id: string): string {
  return products.find((p) => p.id === id)?.name ?? 'product';
}

export async function loadLedger(locationId: string | null = null): Promise<LedgerEntry[]> {
  const [sales, purchases, expenses, returns, movements, journals, products, customerPayments, payslips, productionOrders] = await Promise.all([
    db.sales.toArray(),
    db.purchases.toArray(),
    db.expenses.toArray(),
    db.returns.toArray(),
    db.stockMovements.toArray(),
    db.journals.toArray(),
    db.products.toArray(),
    db.customerPayments.toArray(),
    db.payslips.toArray(),
    db.productionOrders.toArray(),
  ]);
  const inShop = (id?: string): boolean => locationId === null || (id ?? 'main') === locationId;
  return buildLedger({
    sales: sales.filter((s) => inShop(s.locationId)),
    purchases: purchases.filter((p) => inShop(p.locationId)),
    expenses: expenses.filter((e) => inShop(e.locationId)),
    returns: returns.filter((r) => inShop(r.locationId)),
    movements: movements.filter((m) => inShop(m.locationId)),
    journals, // manual journals are business-wide
    products,
    customerPayments: customerPayments.filter((p) => inShop(p.locationId)),
    payslips, // payroll is business-wide
    productionOrders: productionOrders.filter((p) => inShop(p.locationId)),
  });
}

export interface BalanceRow {
  code: string;
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
  balance: number;
}

function inWindow(entries: LedgerEntry[], from?: number, to?: number): LedgerEntry[] {
  return entries.filter((e) => (from === undefined || e.date >= from) && (to === undefined || e.date < to));
}

export function accountBalances(entries: LedgerEntry[], from?: number, to?: number): BalanceRow[] {
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const e of inWindow(entries, from, to)) {
    for (const l of e.lines) {
      const row = totals.get(l.account) ?? { debit: 0, credit: 0 };
      row.debit += l.debit;
      row.credit += l.credit;
      totals.set(l.account, row);
    }
  }
  return CHART_OF_ACCOUNTS.filter((a) => totals.has(a.code)).map((a) => {
    const t = totals.get(a.code)!;
    const debit = round2(t.debit);
    const credit = round2(t.credit);
    const debitPositive = a.type === 'asset' || a.type === 'expense';
    return {
      code: a.code,
      name: a.name,
      type: a.type,
      debit,
      credit,
      balance: round2(debitPositive ? debit - credit : credit - debit),
    };
  });
}

export function trialBalance(entries: LedgerEntry[], from?: number, to?: number): { rows: BalanceRow[]; totalDebit: number; totalCredit: number; balanced: boolean } {
  const rows = accountBalances(entries, from, to);
  const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));
  return { rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.005 };
}

export interface ProfitAndLoss {
  revenue: number;
  returns: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  expenseRows: BalanceRow[];
  expenses: number;
  inventoryAdjustments: number;
  netProfit: number;
}

export function profitAndLoss(entries: LedgerEntry[], from?: number, to?: number): ProfitAndLoss {
  const rows = accountBalances(entries, from, to);
  const row = (code: string): number => rows.find((r) => r.code === code)?.balance ?? 0;
  const revenue = row('4000');
  const returns = -row('4100'); // contra-income: a debit balance reduces revenue
  const otherIncome = row('4200');
  const cogs = row('5000');
  const inventoryAdjustments = row('5150');
  const expenseRows = rows.filter((r) => r.type === 'expense' && r.code !== '5000' && r.code !== '5150');
  const expenses = round2(expenseRows.reduce((s, r) => s + r.balance, 0));
  const netRevenue = round2(revenue + otherIncome - returns);
  const grossProfit = round2(netRevenue - cogs - inventoryAdjustments);
  return {
    revenue,
    returns,
    netRevenue,
    cogs,
    grossProfit,
    expenseRows,
    expenses,
    inventoryAdjustments,
    netProfit: round2(grossProfit - expenses),
  };
}

export interface BalanceSheet {
  assets: BalanceRow[];
  liabilities: BalanceRow[];
  equity: BalanceRow[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  earnings: number;
  difference: number;
}

export function balanceSheet(entries: LedgerEntry[], asOf: number = Date.now() + 1): BalanceSheet {
  const pl = profitAndLoss(entries, undefined, asOf);
  const rows = accountBalances(entries, undefined, asOf);
  const assets = rows.filter((r) => r.type === 'asset');
  const liabilities = rows.filter((r) => r.type === 'liability');
  const equity = rows.filter((r) => r.type === 'equity');
  const totalAssets = round2(assets.reduce((s, r) => s + r.balance, 0));
  const totalLiabilities = round2(liabilities.reduce((s, r) => s + r.balance, 0));
  const totalEquity = round2(equity.reduce((s, r) => s + r.balance, 0));
  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    earnings: pl.netProfit,
    difference: round2(totalAssets - (totalLiabilities + totalEquity + pl.netProfit)),
  };
}

export interface LedgerRow {
  date: number;
  ref: string;
  memo: string;
  debit: number;
  credit: number;
  balance: number;
}

export function accountLedger(entries: LedgerEntry[], code: string, from?: number, to?: number): LedgerRow[] {
  let balance = 0;
  const rows: LedgerRow[] = [];
  const debitPositive = accountType(code) === 'asset' || accountType(code) === 'expense';
  for (const e of inWindow(entries, from, to)) {
    for (const l of e.lines) {
      if (l.account !== code) continue;
      balance += debitPositive ? l.debit - l.credit : l.credit - l.debit;
      rows.push({ date: e.date, ref: e.ref, memo: l.memo ?? e.memo, debit: l.debit, credit: l.credit, balance: round2(balance) });
    }
  }
  return rows;
}

/** Convenience used by screens that post a journal as the signed-in user (or the local operator). */
export function currentOperator(): string {
  return getSession()?.username ?? 'local';
}
