// Tax and sale totals. One implementation is used by the POS preview, checkout, quotations
// and refunds, so the number on screen is the number that gets posted.
import type { TaxLine, TaxRate } from './db';

export interface TaxableLine {
  productId: string;
  qty: number;
  price: number;
  taxRateId?: string;
}

export interface SaleTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  breakdown: TaxLine[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function computeSaleTotals(lines: TaxableLine[], discount: number, rates: TaxRate[]): SaleTotals {
  const subtotal = round2(lines.reduce((s, l) => s + l.qty * l.price, 0));
  const safeDiscount = round2(Math.min(Math.max(discount || 0, 0), subtotal));
  const net = round2(subtotal - safeDiscount);
  const byId = new Map(rates.map((r) => [r.id, r]));
  const buckets = new Map<string, TaxLine>();
  let tax = 0;

  for (const line of lines) {
    if (!line.taxRateId) continue;
    const rate = byId.get(line.taxRateId);
    if (!rate || !rate.active || !(rate.rate > 0)) continue;
    const share = subtotal > 0 ? (line.qty * line.price) / subtotal : 0;
    const base = net * share;
    const amount = round2(rate.inclusive ? (base * rate.rate) / (100 + rate.rate) : (base * rate.rate) / 100);
    if (amount <= 0) continue;
    tax += amount;
    const row = buckets.get(rate.id) ?? { name: rate.name, rate: rate.rate, amount: 0 };
    row.amount = round2(row.amount + amount);
    buckets.set(rate.id, row);
  }

  const exclusive = lines.some((l) => {
    const r = l.taxRateId ? byId.get(l.taxRateId) : undefined;
    return r?.active && !r.inclusive;
  });
  const total = round2(exclusive ? net + tax : net);
  return { subtotal, discount: safeDiscount, tax: round2(tax), total, breakdown: [...buckets.values()] };
}

/** Share of a sale's tax that belongs to a refunded amount. Used to reverse tax correctly. */
export function proportionalTax(sale: { total: number; tax?: number }, refundAmount: number): number {
  if (!sale.tax || !(sale.total > 0)) return 0;
  return Math.round(((refundAmount / sale.total) * sale.tax) * 100) / 100;
}
