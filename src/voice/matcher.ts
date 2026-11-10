// Fuzzy matching of spoken names against local products/customers. Pure functions, no network.
import type { Customer, Product } from '../db';

export function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function stem(t: string): string {
  return t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t;
}

export function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** A rough "how it sounds" skeleton: similar consonants merged, vowels dropped ("Mama" and "Momie" both give "mm"). */
export function skeleton(word: string): string {
  const w = word
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/(.)\1+/g, '$1');
  if (!w) return '';
  const map: Record<string, string> = { c: 'k', q: 'k', g: 'k', z: 's', v: 'f', d: 't', b: 'p', x: 'k' };
  let out = '';
  for (let i = 0; i < w.length; i++) {
    const ch = w[i]!;
    if (i > 0 && 'aeiouyhw'.includes(ch)) continue;
    const m = i === 0 && 'aeiouy'.includes(ch) ? 'a' : (map[ch] ?? ch);
    out += m;
  }
  return out;
}

function soundSim(a: string, b: string): number {
  if (Math.min(a.length, b.length) < 4) return 0; // too short to judge by sound
  const x = skeleton(a);
  const y = skeleton(b);
  if (x.length < 2 || y.length < 2) return 0;
  if (x === y) return 0.9;
  if (x.length < 3 || y.length < 3) return 0;
  return 0.9 * Math.max(0, 1 - lev(x, y) / Math.max(x.length, y.length));
}

function tokSim(a: string, b: string): number {
  if (a === b) return 1;
  if (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.9;
  return Math.max(0, 1 - lev(a, b) / Math.max(a.length, b.length), soundSim(a, b));
}

/** Compares two whole names by sound, ignoring where the word breaks fall ("mom ate" ~ "mama ade"). */
function wholeSoundSim(q: string, t: string): number {
  const x = skeleton(q.replace(/\s+/g, ''));
  const y = skeleton(t.replace(/\s+/g, ''));
  if (x.length < 3 || y.length < 3) return 0;
  if (x === y) return 0.85;
  if (Math.min(x.length, y.length) < 4) return 0;
  return 0.85 * Math.max(0, 1 - lev(x, y) / Math.max(x.length, y.length));
}

export function score(query: string, target: string): number {
  const qt = norm(query).split(' ').filter(Boolean).map(stem);
  const tt = norm(target).split(' ').filter(Boolean).map(stem);
  if (!qt.length || !tt.length) return 0;
  const coverage = qt.reduce((s, q) => s + Math.max(...tt.map((t) => tokSim(q, t))), 0) / qt.length;
  // small penalty when the product name has many extra words the user did not say
  const tokenScore = coverage * (0.85 + 0.15 * Math.min(1, qt.length / tt.length));
  const q = qt.join(' ');
  const t = tt.join(' ');
  const whole = 1 - lev(q, t) / Math.max(q.length, t.length);
  return Math.max(tokenScore, whole, wholeSoundSim(q, t));
}

export function rank(query: string, products: Product[]): { product: Product; score: number }[] {
  return products
    .map((product) => ({
      product,
      score: Math.max(score(query, product.name), ...product.aliases.map((a) => score(query, a) * 0.98)),
    }))
    .sort((a, b) => b.score - a.score);
}

export type Resolution =
  | { status: 'match'; product: Product }
  | { status: 'ambiguous'; options: Product[] }
  | { status: 'none' };

export function resolveProduct(query: string, products: Product[]): Resolution {
  const ranked = rank(query, products);
  const best = ranked[0];
  if (!best || best.score < 0.55) return { status: 'none' };
  // an alias/name that exactly equals the query is never ambiguous
  const exact = ranked.filter((r) => r.score >= 0.97);
  if (exact.length === 1) return { status: 'match', product: exact[0]!.product };
  const close = ranked.filter((r) => r.score >= best.score - 0.1 && r.score >= 0.55);
  if (close.length === 1) return { status: 'match', product: best.product };
  return { status: 'ambiguous', options: close.slice(0, 3).map((r) => r.product) };
}

export function resolveCustomer(query: string, customers: Customer[]): Customer | null {
  let best: { c: Customer; s: number } | null = null;
  for (const c of customers) {
    const s = score(query, c.name);
    if (!best || s > best.s) best = { c, s };
  }
  return best && best.s >= 0.74 ? best.c : null;
}

/** Finds the best match among any named things (suppliers, shops) by sound and spelling. */
export function resolveNamed<T extends { name: string }>(query: string, list: T[], threshold = 0.74): T | null {
  let best: { c: T; s: number } | null = null;
  for (const c of list) {
    const s = score(query, c.name);
    if (!best || s > best.s) best = { c, s };
  }
  return best && best.s >= threshold ? best.c : null;
}
