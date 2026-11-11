import { describe, expect, it } from 'vitest';
import { parseCommand, parseNumberPrefix } from './parser';

const n = (s: string) => parseNumberPrefix(s.split(' '))?.value;

describe('number parsing', () => {
  it('reads digits and words', () => {
    expect(n('2')).toBe(2);
    expect(n('1,500')).toBe(1500);
    expect(n('fifty')).toBe(50);
    expect(n('twenty five')).toBe(25);
    expect(n('one hundred and fifty')).toBe(150);
    expect(n('two thousand five hundred')).toBe(2500);
    expect(n('5 thousand')).toBe(5000);
    expect(n('5k')).toBe(5000);
    expect(n('a')).toBe(1);
  });
  it('returns null for non-numbers', () => {
    expect(parseNumberPrefix(['rice'])).toBeNull();
  });
});

describe('sell', () => {
  it('parses qty, product, customer, payment', () => {
    expect(parseCommand('Sell two bags of rice to Mama Ade, cash')).toEqual({
      type: 'sell',
      items: [{ qty: 2, unit: 'bags', name: 'rice' }],
      customer: 'mama ade',
      payment: 'cash',
    });
  });
  it('parses payment before customer', () => {
    const r = parseCommand('sell 3 coke in transfer to chinedu okafor');
    expect(r).toMatchObject({ type: 'sell', customer: 'chinedu okafor', payment: 'transfer' });
  });
  it('parses multiple items', () => {
    const r = parseCommand('sell two rice and five indomie');
    expect(r).toMatchObject({
      type: 'sell',
      items: [{ qty: 2, name: 'rice' }, { qty: 5, name: 'indomie' }],
    });
  });
  it('defaults qty to 1', () => {
    expect(parseCommand('sell sugar')).toMatchObject({ type: 'sell', items: [{ qty: 1, name: 'sugar' }] });
  });
  it('handles polite filler', () => {
    expect(parseCommand('Please sell 10 fanta')).toMatchObject({ type: 'sell', items: [{ qty: 10, name: 'fanta' }] });
  });
});

describe('add stock', () => {
  it('parses word quantities', () => {
    expect(parseCommand('Add fifty cartons of Indomie to stock')).toEqual({
      type: 'add_stock',
      items: [{ qty: 50, unit: 'cartons', name: 'indomie' }],
    });
  });
  it('parses units', () => {
    expect(parseCommand('add 10 units of sugar')).toMatchObject({ type: 'add_stock', items: [{ qty: 10, name: 'sugar' }] });
  });
  it('parses restock', () => {
    expect(parseCommand('restock 24 coke')).toMatchObject({ type: 'add_stock', items: [{ qty: 24, name: 'coke' }] });
  });
});

describe('check stock', () => {
  it.each([
    ['how many coke bottles do I have left', 'coke bottles'],
    ['how much rice is left', 'rice'],
    ['check stock of sugar', 'sugar'],
    ["what's the stock of fanta", 'fanta'],
    ['do I have spaghetti', 'spaghetti'],
    ['how many indomie', 'indomie'],
  ])('%s', (text, product) => {
    expect(parseCommand(text)).toEqual({ type: 'check_stock', product });
  });
});

describe('price, reports, control', () => {
  it('sets price', () => {
    expect(parseCommand('Change the price of sugar to 1,500')).toEqual({ type: 'set_price', product: 'sugar', price: 1500 });
    expect(parseCommand('set price of rice to forty eight thousand')).toMatchObject({ type: 'set_price', product: 'rice' });
  });
  it('reports', () => {
    expect(parseCommand('What did I sell today?').type).toBe('report_today');
    expect(parseCommand("today's sales").type).toBe('report_today');
    expect(parseCommand("what's running low").type).toBe('low_stock');
    expect(parseCommand('low stock').type).toBe('low_stock');
  });
  it('confirm, cancel, undo', () => {
    expect(parseCommand('yes').type).toBe('confirm');
    expect(parseCommand('Confirm').type).toBe('confirm');
    expect(parseCommand('no').type).toBe('cancel');
    expect(parseCommand('cancel that').type).toBe('cancel');
    expect(parseCommand('undo').type).toBe('undo');
  });
  it('unknown / noise', () => {
    expect(parseCommand('').type).toBe('unknown');
    expect(parseCommand('hello there how is the weather').type).toBe('unknown');
    expect(parseCommand('sell').type).toBe('unknown');
  });
});

describe('speech-recognition slips (real transcripts from the offline model)', () => {
  it('"Cell" and "Sale" at the start still mean sell', () => {
    expect(parseCommand('Cell 2 bags of rice to mom-aid cash')).toMatchObject({ type: 'sell', items: [{ qty: 2, name: 'rice' }], payment: 'cash' });
    expect(parseCommand('cell 5 Fontaine and 3 spaghetti')).toMatchObject({ type: 'sell', items: [{ qty: 5, name: 'fontaine' }, { qty: 3, name: 'spaghetti' }] });
    expect(parseCommand('Sale a bag of rice')).toMatchObject({ type: 'sell' });
  });
  it('"At 50 cartoons ..." means add', () => {
    expect(parseCommand('At 50 cartoons of Indomietta Stock')).toMatchObject({ type: 'add_stock', items: [{ qty: 50, name: 'indomietta' }] });
  });
  it('does not rewrite ordinary sentences', () => {
    expect(parseCommand('cell phone charger').type).toBe('unknown');
    expect(parseCommand('at the market').type).toBe('unknown');
  });
  it('a number stuck to its unit', () => {
    expect(parseCommand('Add 50kg of Indomie to stock')).toMatchObject({ type: 'add_stock', items: [{ qty: 50, unit: 'kg', name: 'indomie' }] });
  });
  it('ignores the full stops and commas a speech model adds', () => {
    expect(parseCommand('Sell 2 bags of rice to Mama Ade, cash.')).toEqual({
      type: 'sell', items: [{ qty: 2, unit: 'bags', name: 'rice' }], customer: 'mama ade', payment: 'cash',
    });
    expect(parseCommand('What did I sell today?').type).toBe('report_today');
    expect(parseCommand('Change the price of sugar to 1,500.')).toEqual({ type: 'set_price', product: 'sugar', price: 1500 });
    expect(parseCommand('Change the price of rice to 1.5')).toMatchObject({ price: 1.5 });
  });
});


describe('purchases, suppliers and transfers', () => {
  it('goods received from a supplier, with price and payment', () => {
    expect(parseCommand('Received 20 bags of rice from Dangote at 41000 each, paid 500000')).toEqual({
      type: 'receive_purchase', items: [{ qty: 20, unit: 'bags', name: 'rice', cost: 41000 }], supplier: 'dangote', paid: 500000,
    });
    expect(parseCommand('bought 20 bags of rice at 41,000 each and 10 cartons of indomie at 7,500 each from Dangote paid in full')).toEqual({
      type: 'receive_purchase',
      items: [{ qty: 20, unit: 'bags', name: 'rice', cost: 41000 }, { qty: 10, unit: 'cartons', name: 'indomie', cost: 7500 }],
      supplier: 'dangote', paid: 'full',
    });
    expect(parseCommand('received ten rice from Mama Nkechi on credit')).toMatchObject({ type: 'receive_purchase', supplier: 'mama nkechi', paid: 0, items: [{ qty: 10, name: 'rice' }] });
    expect(parseCommand('received 5 coke from Dangote at 220 each')).toMatchObject({ supplier: 'dangote', items: [{ qty: 5, name: 'coke', cost: 220 }] });
    expect(parseCommand('received 5 coke from Dangote for two hundred and twenty each paid 1000')).toMatchObject({ supplier: 'dangote', paid: 1000, items: [{ cost: 220 }] });
    expect(parseCommand('Received fifty kg of rice from Dangote at forty one thousand five hundred each')).toMatchObject({ items: [{ qty: 50, cost: 41500 }] });
  });
  it('plain "received" with no supplier is still just adding stock', () => {
    expect(parseCommand('received 20 rice')).toEqual({ type: 'add_stock', items: [{ qty: 20, unit: undefined, name: 'rice' }] });
  });
  it('how much is owed', () => {
    expect(parseCommand('how much do I owe Dangote')).toEqual({ type: 'supplier_balance', supplier: 'dangote' });
    expect(parseCommand('how much do I owe')).toEqual({ type: 'supplier_balance', supplier: undefined });
    expect(parseCommand('who do I owe')).toEqual({ type: 'supplier_balance', supplier: undefined });
    expect(parseCommand('what do we owe to Dangote Distributors')).toEqual({ type: 'supplier_balance', supplier: 'dangote distributors' });
    // ...without stealing ordinary stock questions
    expect(parseCommand('how much rice do I have')).toEqual({ type: 'check_stock', product: 'rice' });
  });
  it('paying a supplier', () => {
    expect(parseCommand('pay Dangote 100000')).toEqual({ type: 'pay_supplier', supplier: 'dangote', amount: 100000 });
    expect(parseCommand('I paid Dangote 100,000')).toEqual({ type: 'pay_supplier', supplier: 'dangote', amount: 100000 });
    expect(parseCommand('pay 50 thousand to Mama Nkechi')).toEqual({ type: 'pay_supplier', supplier: 'mama nkechi', amount: 50000 });
    expect(parseCommand('pay Dangote')).toEqual({ type: 'unknown' }); // no amount: do not guess
  });
  it('sending goods to another shop, and confirming arrival', () => {
    expect(parseCommand('transfer 5 bags of rice to Ikeja branch')).toEqual({ type: 'transfer', items: [{ qty: 5, unit: 'bags', name: 'rice' }], shop: 'ikeja branch' });
    expect(parseCommand('send ten coke and five fanta to the Ikeja shop')).toMatchObject({ type: 'transfer', shop: 'ikeja shop', items: [{ qty: 10, name: 'coke' }, { qty: 5, name: 'fanta' }] });
    expect(parseCommand('transfer arrived')).toEqual({ type: 'receive_transfer', from: undefined });
    expect(parseCommand('goods arrived from main shop')).toEqual({ type: 'receive_transfer', from: 'main shop' });
    expect(parseCommand('receive transfer')).toEqual({ type: 'receive_transfer', from: undefined });
  });
  it('selling to a customer is not mistaken for a transfer', () => {
    expect(parseCommand('sell two rice to Mama Ade cash')).toMatchObject({ type: 'sell', customer: 'mama ade' });
  });
});

describe('expiry questions', () => {
  it('understands what is expiring', () => {
    for (const s of ["what's expiring", 'what has expired', 'anything going bad', 'what is out of date', 'which goods expire soon']) {
      expect(parseCommand(s).type, s).toBe('expiring');
    }
  });
});
