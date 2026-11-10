import { describe, expect, it } from 'vitest';
import type { Customer, Product } from '../db';
import { resolveCustomer, resolveProduct, skeleton } from './matcher';

const p = (name: string, aliases: string[] = []): Product => ({
  id: name, name, sku: '', aliases, price: 1, cost: 0, unit: 'pcs', stock: 1, lowStockAt: 1, updatedAt: 0,
});
const products = [
  p('Rice 50kg Bag', ['rice']), p('Indomie Noodles Carton', ['indomie']), p('Coke Bottle 50cl', ['coke']),
  p('Fanta Bottle 50cl', ['fanta']), p('Sugar 1kg', ['sugar']), p('Vegetable Oil 5L', ['oil']), p('Spaghetti Pack', ['spaghetti']),
];
const name = (q: string): string | undefined => {
  const r = resolveProduct(q, products);
  return r.status === 'match' ? r.product.name : undefined;
};

describe('sound-alike matching (real mis-hearings from the offline model)', () => {
  it('skeletons', () => {
    expect(skeleton('Mama')).toBe(skeleton('Momie'));
    expect(skeleton('Fanta')).toBe('fnt');
  });
  it('products heard wrongly still resolve', () => {
    expect(name('fontaine')).toBe('Fanta Bottle 50cl');
    expect(name('fonda')).toBe('Fanta Bottle 50cl');
    expect(name('spogatti')).toBe('Spaghetti Pack');
    expect(name('indometer')).toBe('Indomie Noodles Carton');
    expect(name('indomita')).toBe('Indomie Noodles Carton');
    expect(name('coke battles')).toBe('Coke Bottle 50cl');
  });
  it('does not invent matches for unrelated words', () => {
    expect(name('laptop')).toBeUndefined();
    expect(name('television')).toBeUndefined();
  });
  it('customers heard wrongly still resolve to the existing customer', () => {
    const customers: Customer[] = [{ id: '1', name: 'Mama Ade' }, { id: '2', name: 'Chinedu Okafor' }];
    expect(resolveCustomer('momie ade', customers)?.name).toBe('Mama Ade');
    expect(resolveCustomer('mom ate', customers)?.name).toBe('Mama Ade'); // word break moved
    expect(resolveCustomer('tamamu ade', customers)?.name).toBe('Mama Ade');
    expect(resolveCustomer('chinedu okafor', customers)?.name).toBe('Chinedu Okafor');
    expect(resolveCustomer('john smith', customers)).toBeNull();
    expect(resolveCustomer('sam peter', customers)).toBeNull();
  });
});
