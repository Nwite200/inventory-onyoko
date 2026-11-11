import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { SYMBOLS, canEncode, encode } from './code128';

// jsbarcode is an independent implementation: it is the reference these bars are compared against.
const require = createRequire(import.meta.url);
const CODE128B = require('jsbarcode/bin/barcodes/CODE128/CODE128B.js').default as new (t: string, o: object) => { encode(): { data: string } };
const reference = (text: string): string => new CODE128B(text, {}).encode().data;

describe('Code 128 symbol table', () => {
  it('has 107 distinct patterns of the right size', () => {
    expect(SYMBOLS).toHaveLength(107);
    expect(new Set(SYMBOLS).size).toBe(107);
    SYMBOLS.slice(0, 106).forEach((w) => expect([...w].reduce((s, d) => s + Number(d), 0)).toBe(11));
    expect([...SYMBOLS[106]!].reduce((s, d) => s + Number(d), 0)).toBe(13);
  });
});

describe('Code 128 encoding', () => {
  const samples = ['A', 'Hello', 'Rice 50kg Bag', '6001234567890', '0000', 'OP-000123', '~', ' ', 'a b~c!"#$%&\'()*+,-./09:;<=>?@AZ[\\]^_`az{|}', 'x'.repeat(80)];
  for (const s of samples) {
    it(`matches the reference for "${s.length > 20 ? s.slice(0, 20) + '…' : s}"`, () => {
      expect(encode(s)).toBe(reference(s));
    });
  }
  it('matches the reference for 3000 random strings', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 3000; i++) {
      const len = 1 + Math.floor(rnd() * 30);
      const s = Array.from({ length: len }, () => String.fromCharCode(32 + Math.floor(rnd() * 95))).join('');
      expect(encode(s)).toBe(reference(s));
    }
  });
  it('starts with the start pattern and ends with the stop pattern plus its final bar', () => {
    const bars = encode('Hi');
    expect(bars.startsWith('11010010000')).toBe(true); // start B
    expect(bars.endsWith('1100011101011')).toBe(true); // stop
  });
  it('rejects text it cannot write, instead of printing a wrong barcode', () => {
    expect(canEncode('Ọmọ')).toBe(false);
    expect(canEncode('')).toBe(false);
    expect(canEncode('x'.repeat(81))).toBe(false);
    expect(() => encode('café')).toThrow(/no accents/);
  });
});
