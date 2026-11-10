import { describe, expect, it } from 'vitest';
import type { Customer, Product } from '../db';
import { buildHint } from './hint';

const p = (id: string, name: string, aliases: string[] = []): Product => ({ id, name, sku: '', aliases, price: 1, cost: 0, unit: 'pcs', stock: 1, lowStockAt: 1, updatedAt: 0 });

describe('buildHint', () => {
  const products = [p('a', 'Zobo Drink'), p('b', 'Indomie Noodles Carton', ['indomie', 'noodles']), p('c', 'Rice 50kg Bag', ['rice'])];
  const customers: Customer[] = [{ id: '1', name: 'Mama Ade' }];

  it('includes command words, product names, aliases and customers', () => {
    const h = buildHint(products, customers, new Map());
    expect(h).toMatch(/^Sell, add stock/);
    expect(h).toContain('Indomie Noodles Carton, indomie, noodles');
    expect(h).toContain('Mama Ade');
  });
  it('puts best sellers first', () => {
    const h = buildHint(products, customers, new Map([['a', 50]]));
    expect(h.indexOf('Zobo Drink')).toBeLessThan(h.indexOf('Indomie'));
  });
  it('stays short even for a huge catalogue', () => {
    const many = Array.from({ length: 800 }, (_, i) => p(String(i), `Product number ${i} with a long name`));
    expect(buildHint(many, customers, new Map()).length).toBeLessThan(520);
  });
  it('copes with an empty shop', () => {
    expect(buildHint([], [], new Map())).toMatch(/^Sell, add stock/);
  });
});
