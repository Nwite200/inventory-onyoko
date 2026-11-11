import { describe, expect, it } from 'vitest';
import { validateIntent } from './llm';

// The language model's answer is untrusted text: anything that is not exactly right is thrown away.
describe('LLM answers for purchases, suppliers and transfers', () => {
  it('accepts well-formed purchases, payments, balances and transfers', () => {
    expect(validateIntent({ type: 'receive_purchase', items: [{ qty: 20, name: 'rice', cost: 41000 }, { qty: 2, name: 'sugar', cost: null }], supplier: 'Dangote', paid: 'full' }))
      .toEqual({ type: 'receive_purchase', items: [{ qty: 20, name: 'rice', cost: 41000 }, { qty: 2, name: 'sugar' }], supplier: 'Dangote', paid: 'full' });
    expect(validateIntent({ type: 'receive_purchase', items: [{ qty: 1, name: 'rice' }], supplier: 'X', paid: null })).toMatchObject({ paid: undefined });
    expect(validateIntent({ type: 'pay_supplier', supplier: 'Dangote', amount: 5000 })).toEqual({ type: 'pay_supplier', supplier: 'Dangote', amount: 5000 });
    expect(validateIntent({ type: 'supplier_balance', supplier: null })).toEqual({ type: 'supplier_balance', supplier: undefined });
    expect(validateIntent({ type: 'transfer', items: [{ qty: 5, name: 'rice' }], shop: 'Ikeja branch' })).toEqual({ type: 'transfer', items: [{ qty: 5, name: 'rice' }], shop: 'Ikeja branch' });
    expect(validateIntent({ type: 'receive_transfer', from: null })).toEqual({ type: 'receive_transfer', from: undefined });
  });
  it('rejects nonsense, negative or absurd numbers, and missing names', () => {
    expect(validateIntent({ type: 'receive_purchase', items: [{ qty: 1, name: 'rice', cost: -5 }], supplier: 'X' })).toBeNull();
    expect(validateIntent({ type: 'receive_purchase', items: [{ qty: 1, name: 'rice', cost: '41000' }], supplier: 'X' })).toBeNull();
    expect(validateIntent({ type: 'receive_purchase', items: [{ qty: 1, name: 'rice' }], supplier: '  ' })).toBeNull();
    expect(validateIntent({ type: 'receive_purchase', items: [], supplier: 'X' })).toBeNull();
    expect(validateIntent({ type: 'pay_supplier', supplier: 'X', amount: -1 })).toBeNull();
    expect(validateIntent({ type: 'pay_supplier', supplier: 'X', amount: '5000' })).toBeNull();
    expect(validateIntent({ type: 'transfer', items: [{ qty: 5, name: 'rice' }], shop: '' })).toBeNull();
    expect(validateIntent({ type: 'transfer', items: [{ qty: 0, name: 'rice' }], shop: 'Y' })).toBeNull();
    expect(validateIntent({ type: 'delete_everything' })).toBeNull();
  });
});

describe('expiring intent from the model', () => {
  it('is accepted', () => {
    expect(validateIntent({ type: 'expiring' })).toEqual({ type: 'expiring' });
  });
});
