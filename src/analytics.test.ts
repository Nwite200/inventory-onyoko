import { describe, expect, it } from 'vitest';
import type { Expense, Product, Purchase, Sale, SaleReturn, StockMovement } from './db';
import { buildSeries, cashFlow, costOfGoodsSold, percentChange, salesInRange, stockByLocation, stockOf, sumSales } from './analytics';

const at = Date.UTC(2026, 4, 12, 10);
const sale = (over: Partial<Sale> = {}): Sale => ({
  id: `s-${Math.random()}`,
  number: 'INV-1',
  at,
  customerName: 'Walk-in',
  payment: 'cash',
  items: [{ productId: 'p1', name: 'Rice', qty: 2, price: 100 }],
  total: 200,
  status: 'completed',
  locationId: 'main',
  ...over,
});

describe('analytics helpers', () => {
  it('computes percentage change with a sensible empty baseline', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(0, 0)).toBeNull();
    expect(percentChange(10, 0)).toBe(100);
  });

  it('filters sales by date, status and branch', () => {
    const rows = [
      sale({ id: 'a', at: 100, locationId: 'main' }),
      sale({ id: 'b', at: 200, locationId: 'ikeja' }),
      sale({ id: 'c', at: 300, locationId: 'main', status: 'voided' }),
      sale({ id: 'd', at: 50, locationId: undefined }),
    ];
    expect(salesInRange(rows, 0, 1000).map((s) => s.id)).toEqual(['a', 'b', 'd']);
    expect(salesInRange(rows, 0, 1000, 'main').map((s) => s.id)).toEqual(['a', 'd']);
    expect(salesInRange(rows, 0, 1000, 'ikeja').map((s) => s.id)).toEqual(['b']);
    expect(sumSales(salesInRange(rows, 0, 1000))).toBe(600);
  });

  it('buckets a series without losing the last day', () => {
    const from = 0;
    const to = 3 * 86_400_000;
    const rows = [sale({ at: 1 }), sale({ at: to - 1 }), sale({ at: from + 86_400_000 })];
    const points = buildSeries(rows, from, to, 3);
    expect(points).toHaveLength(3);
    expect(points.map((p) => p.value)).toEqual([200, 200, 200]);
    expect(points[0]!.label).toBeTruthy();
  });

  it('derives stock per shop from movements, not from a stored number', () => {
    const movements: StockMovement[] = [
      { id: '1', productId: 'p1', delta: 5, reason: 'opening', at, locationId: 'main' },
      { id: '2', productId: 'p1', delta: 3, reason: 'opening', at, locationId: 'ikeja' },
      { id: '3', productId: 'p1', delta: -1, reason: 'sale', at, locationId: 'main' },
      { id: '4', productId: 'p2', delta: 9, reason: 'opening', at, locationId: 'main' },
    ];
    const byShop = stockByLocation(movements);
    expect(stockOf('p1', byShop, 'main')).toBe(4);
    expect(stockOf('p1', byShop, 'ikeja')).toBe(3);
    expect(stockOf('p1', byShop, null)).toBe(7);
    expect(stockOf('nope', byShop, null)).toBe(0);
  });

  it('uses the cost captured on the sale line, falling back to the catalogue', () => {
    const products: Product[] = [{ id: 'p1', name: 'Rice', sku: '', aliases: [], price: 100, cost: 60, unit: 'bag', stock: 0, lowStockAt: 1, updatedAt: at }];
    const rows = [sale({ items: [{ productId: 'p1', name: 'Rice', qty: 2, price: 100, cost: 55 }] }), sale({ items: [{ productId: 'p1', name: 'Rice', qty: 1, price: 100 }] })];
    expect(costOfGoodsSold({ sales: rows, products })).toBe(170);
  });

  it('counts only cash movements as cash flow', () => {
    const expenses: Expense[] = [{ id: 'e1', category: 'Rent', amount: 50, paymentMethod: 'cash', at, locationId: 'main' }, { id: 'e2', category: 'Rent', amount: 30, paymentMethod: 'transfer', at, locationId: 'main' }];
    const purchases: Purchase[] = [{ id: 'pu1', number: 'PO-1', at, supplierId: 'x', supplierName: 'X', items: [], total: 500, paid: 200, payments: [], status: 'received', locationId: 'main' }];
    const returns: SaleReturn[] = [{ id: 'r1', number: 'RET-1', saleId: 's1', saleNumber: 'INV-1', at, customerName: 'Walk-in', items: [], totalRefunded: 20, paymentMethod: 'cash', locationId: 'main', status: 'completed' }];
    const flow = cashFlow([sale(), sale({ payment: 'transfer' })], expenses, purchases, returns, 'main');
    expect(flow.in).toBe(200);
    expect(flow.out).toBe(270); // 50 cash expense + 200 cash purchase + 20 refund
  });
});
