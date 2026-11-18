// Reporting queries. No React, no formatting: everything here is testable with plain data.
// All money is in major units, matching the database.
import { db } from './db';
import type { Expense, Lot, Product, Purchase, Sale, SaleReturn, StockMovement } from './db';

export const DAY = 86_400_000;

export const startOfDay = (ts = Date.now()): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export interface Point {
  at: number;
  label: string;
  value: number;
}

export interface Snapshot {
  days: number;
  from: number;
  to: number;
  revenue: number;
  previousRevenue: number;
  salesCount: number;
  todayRevenue: number;
  todayCount: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  returnsTotal: number;
  purchasesTotal: number;
  payables: number;
  receivables: number;
  cashIn: number;
  cashOut: number;
  inventoryValue: number;
  retailValue: number;
  lowStock: { id: string; name: string; stock: number; lowStockAt: number; unit: string }[];
  outOfStock: number;
  expiring: number;
  series: Point[];
  topProducts: { id: string; name: string; qty: number; revenue: number }[];
  paymentMix: { method: string; total: number; count: number }[];
  recentSales: Sale[];
}

const inShop = (locationId: string | undefined, filter: string | null): boolean =>
  filter === null || (locationId ?? 'main') === filter;

/** Sales in [from, to), completed, optionally for one shop. */
export function salesInRange(sales: Sale[], from: number, to: number, locationId: string | null = null): Sale[] {
  return sales.filter((s) => s.status === 'completed' && s.at >= from && s.at < to && inShop(s.locationId, locationId));
}

export function sumSales(sales: Sale[]): number {
  return sales.reduce((sum, s) => sum + s.total, 0);
}

/** Percentage change, or null when there is no meaningful baseline. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

/** Buckets sales into `pointCount` equal periods. Works for a day (hours) and for months (days). */
export function buildSeries(sales: Sale[], from: number, to: number, pointCount: number): Point[] {
  const count = Math.max(1, Math.floor(pointCount));
  const span = Math.max(1, to - from);
  const step = span / count;
  const buckets = Array.from({ length: count }, (_, i) => ({
    at: from + i * step,
    label: '',
    value: 0,
  }));
  for (const s of sales) {
    const i = Math.min(count - 1, Math.max(0, Math.floor((s.at - from) / step)));
    buckets[i]!.value += s.total;
  }
  const daily = span > 2 * DAY;
  for (const b of buckets) {
    const d = new Date(b.at);
    b.label = daily
      ? d.toLocaleDateString('en', { day: 'numeric', month: 'short' })
      : d.toLocaleTimeString('en', { hour: 'numeric' });
  }
  return buckets;
}

/** Stock per product per shop, derived from the immutable movement ledger. */
export function stockByLocation(movements: StockMovement[]): Map<string, Map<string, number>> {
  const byShop = new Map<string, Map<string, number>>();
  for (const m of movements) {
    const shop = m.locationId ?? 'main';
    const perShop = byShop.get(shop) ?? new Map<string, number>();
    perShop.set(m.productId, (perShop.get(m.productId) ?? 0) + m.delta);
    byShop.set(shop, perShop);
  }
  return byShop;
}

/** Total units for a product, either in one shop or across every shop. */
export function stockOf(productId: string, byShop: Map<string, Map<string, number>>, locationId: string | null): number {
  if (locationId !== null) return byShop.get(locationId)?.get(productId) ?? 0;
  let total = 0;
  for (const perShop of byShop.values()) total += perShop.get(productId) ?? 0;
  return total;
}

export interface ProfitInput {
  sales: Sale[];
  products: Product[];
}

/** COGS from the cost captured at sale time, falling back to the current product cost. */
export function costOfGoodsSold({ sales, products }: ProfitInput): number {
  const cost = new Map(products.map((p) => [p.id, p.cost]));
  return sales.reduce(
    (sum, s) => sum + s.items.reduce((line, item) => line + item.qty * (item.cost ?? cost.get(item.productId) ?? 0), 0),
    0,
  );
}

export function totalExpenses(expenses: Expense[], from: number, to: number, locationId: string | null): number {
  return expenses
    .filter((e) => e.at >= from && e.at < to && inShop(e.locationId, locationId))
    .reduce((sum, e) => sum + e.amount, 0);
}

export function cashFlow(
  sales: Sale[],
  expenses: Expense[],
  purchases: Purchase[],
  returns: SaleReturn[],
  locationId: string | null,
  customerPayments: { amount: number; method: string; locationId?: string }[] = [],
): { in: number; out: number } {
  const cashIn = sales.reduce((sum, s) => sum + (s.payments?.length ? s.payments.filter((p) => p.method === 'cash').reduce((n, p) => n + p.amount, 0) : s.payment === 'cash' ? s.total : 0), 0)
    + customerPayments.filter((p) => p.method === 'cash' && inShop(p.locationId, locationId)).reduce((n, p) => n + p.amount, 0);
  const cashExpenses = expenses.filter((e) => e.paymentMethod === 'cash' && inShop(e.locationId, locationId)).reduce((n, e) => n + e.amount, 0);
  const cashPurchases = purchases.filter((p) => p.status === 'received' && inShop(p.locationId, locationId)).reduce((n, p) => n + p.paid, 0);
  const cashRefunds = returns.filter((r) => r.status === 'completed' && r.paymentMethod === 'cash' && inShop(r.locationId, locationId)).reduce((n, r) => n + r.totalRefunded, 0);
  return { in: cashIn, out: cashExpenses + cashPurchases + cashRefunds };
}

export async function loadDashboard(days: number, locationId: string | null): Promise<Snapshot> {
  const to = startOfDay() + DAY;
  const span = days * DAY;
  const from = to - span;
  const previousFrom = from - span;

  const [allSales, products, expenses, purchases, returns, movements, lots, customerPayments] = await Promise.all([
    db.sales.toArray(),
    db.products.toArray(),
    db.expenses.toArray(),
    db.purchases.toArray(),
    db.returns.toArray(),
    db.stockMovements.toArray(),
    db.lots.toArray(),
    db.customerPayments.toArray(),
  ]);

  const byShop = stockByLocation(movements);
  const current = salesInRange(allSales, from, to, locationId);
  const previous = salesInRange(allSales, previousFrom, from, locationId);
  const todayStart = startOfDay();
  const today = salesInRange(allSales, todayStart, to, locationId);
  const revenue = sumSales(current);
  const cogs = costOfGoodsSold({ sales: current, products });
  const expenseTotal = totalExpenses(expenses, from, to, locationId);
  const rangeReturns = returns.filter((r) => r.status === 'completed' && r.at >= from && r.at < to && inShop(r.locationId, locationId));
  const returnsTotal = rangeReturns.reduce((s, r) => s + r.totalRefunded, 0);
  const rangePurchases = purchases.filter((p) => p.status === 'received' && p.at >= from && p.at < to && inShop(p.locationId, locationId));
  const purchasesTotal = rangePurchases.reduce((s, p) => s + p.total, 0);

  const payables = purchases
    .filter((p) => p.status === 'received' && inShop(p.locationId, locationId))
    .reduce((s, p) => s + Math.max(0, p.total - p.paid), 0);

  const creditOf = (s: Sale): number => (s.payments?.length ? s.payments.filter((p) => p.method === 'credit').reduce((n, p) => n + p.amount, 0) : s.payment === 'credit' ? s.total : 0);
  const creditSales = allSales.filter((s) => s.status === 'completed' && inShop(s.locationId, locationId) && creditOf(s) > 0);
  const creditReturns = returns.filter((r) => r.status === 'completed' && r.paymentMethod === 'credit' && inShop(r.locationId, locationId));
  const paidAgainstCredit = customerPayments.filter((p) => inShop(p.locationId, locationId)).reduce((s, p) => s + p.amount, 0);
  const receivables = Math.max(0, creditSales.reduce((s, x) => s + creditOf(x), 0) - creditReturns.reduce((s, r) => s + r.totalRefunded, 0) - paidAgainstCredit);

  let inventoryValue = 0;
  let retailValue = 0;
  const lowStock: Snapshot['lowStock'] = [];
  let outOfStock = 0;
  for (const p of products) {
    const stock = stockOf(p.id, byShop, locationId);
    if (stock > 0) {
      inventoryValue += stock * p.cost;
      retailValue += stock * p.price;
    }
    if (stock <= 0) outOfStock++;
    else if (stock <= p.lowStockAt) lowStock.push({ id: p.id, name: p.name, stock, lowStockAt: p.lowStockAt, unit: p.unit });
  }
  lowStock.sort((a, b) => a.stock - b.stock);

  const soon = Date.now() + 30 * DAY;
  const expiring = (lots as Lot[]).filter((l) => l.expiresAt < soon && inShop(l.locationId, locationId)).length;

  const sellers = new Map<string, { id: string; name: string; qty: number; revenue: number }>();
  const payments = new Map<string, { method: string; total: number; count: number }>();
  for (const sale of current) {
    const tenders = sale.payments?.length ? sale.payments : [{ method: sale.payment, amount: sale.total }];
    for (const tender of tenders) {
      payments.set(tender.method, {
        method: tender.method,
        total: (payments.get(tender.method)?.total ?? 0) + tender.amount,
        count: (payments.get(tender.method)?.count ?? 0) + 1,
      });
    }
    for (const item of sale.items) {
      const row = sellers.get(item.productId) ?? { id: item.productId, name: item.name, qty: 0, revenue: 0 };
      row.qty += item.qty;
      row.revenue += item.qty * item.price;
      sellers.set(item.productId, row);
    }
  }
  const topProducts = [...sellers.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  const paymentMix = [...payments.values()].sort((a, b) => b.total - a.total);

  const cash = cashFlow(current, expenses, purchases, returns, locationId, customerPayments);
  const pointCount = days === 1 ? 12 : days;
  const series = buildSeries(current, from, to, pointCount);

  return {
    days,
    from,
    to,
    revenue,
    previousRevenue: sumSales(previous),
    salesCount: current.length,
    todayRevenue: sumSales(today),
    todayCount: today.length,
    cogs,
    grossProfit: revenue - cogs,
    expenses: expenseTotal,
    netProfit: revenue - cogs - expenseTotal - returnsTotal,
    returnsTotal,
    purchasesTotal,
    payables,
    receivables,
    cashIn: cash.in,
    cashOut: cash.out,
    inventoryValue,
    retailValue,
    lowStock: lowStock.slice(0, 6),
    outOfStock,
    expiring,
    series,
    topProducts,
    paymentMix,
    recentSales: [...current].sort((a, b) => b.at - a.at).slice(0, 6),
  };
}

/** Range options used by the dashboard and reports. */
export const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;
