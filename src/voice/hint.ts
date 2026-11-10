// The "hint" given to the speech model before it listens: the shop's own words. This is what makes it
// spell "Indomie" and "Mama Ade" correctly instead of "Indometer" and "Momie Ade".
import { db, type Customer, type Product } from '../db';

const COMMAND_WORDS = 'Sell, add stock, how many, price, today, low stock, received from, transfer, owe, pay.';

/** Pure: builds the hint text. Products that sell often come first; the length is capped (the model has little room). */
export function buildHint(products: Product[], customers: Customer[], soldRecently: Map<string, number>, maxChars = 420, others: string[] = []): string {
  const ordered = [...products].sort((a, b) => (soldRecently.get(b.id) ?? 0) - (soldRecently.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  const names: string[] = [];
  let used = COMMAND_WORDS.length + 40; // room for the customer list
  for (const p of ordered) {
    const words = [p.name, ...p.aliases.slice(0, 2)].filter((w) => !names.includes(w));
    const add = words.join(', ');
    if (used + add.length + 2 > maxChars) break;
    names.push(add);
    used += add.length + 2;
  }
  const people = customers
    .map((c) => c.name)
    .slice(-8)
    .join(', ');
  // suppliers and shop names, so "Dangote" and "Ikeja" are spelled the way the shop spells them
  const more = others.slice(0, 6).join(', ');
  return [COMMAND_WORDS, names.length ? names.join(', ') + '.' : '', people ? people + '.' : '', more ? more + '.' : ''].filter(Boolean).join(' ');
}

export async function loadHint(): Promise<string> {
  const [products, customers, suppliers, locations, sales] = await Promise.all([
    db.products.toArray(),
    db.customers.toArray(),
    db.suppliers.toArray(),
    db.locations.toArray(),
    db.sales.where('at').above(Date.now() - 30 * 86_400_000).toArray(),
  ]);
  const sold = new Map<string, number>();
  for (const s of sales) if (s.status === 'completed') for (const l of s.items) sold.set(l.productId, (sold.get(l.productId) ?? 0) + l.qty);
  return buildHint(products, customers, sold, 420, [...suppliers.map((s) => s.name), ...locations.map((l) => l.name)]);
}
