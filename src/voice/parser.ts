// Layer 1: rule-based command parser. Instant, deterministic, works fully offline.
export interface ItemSpec {
  qty: number;
  unit?: string;
  name: string;
  /** What was paid per unit (purchases only), when the speaker said it. */
  cost?: number;
}

export type Intent =
  | { type: 'sell'; items: ItemSpec[]; customer?: string; payment?: string }
  | { type: 'add_stock'; items: ItemSpec[] }
  | { type: 'check_stock'; product: string }
  | { type: 'set_price'; product: string; price: number }
  | { type: 'receive_purchase'; items: ItemSpec[]; supplier: string; paid?: number | 'full' }
  | { type: 'pay_supplier'; supplier: string; amount: number }
  | { type: 'supplier_balance'; supplier?: string }
  | { type: 'transfer'; items: ItemSpec[]; shop: string }
  | { type: 'receive_transfer'; from?: string }
  | { type: 'report_today' }
  | { type: 'low_stock' }
  | { type: 'expiring' }
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'undo' }
  | { type: 'unknown' };

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, a: 1, an: 1,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const isNumWord = (t: string | undefined): boolean =>
  !!t && (t in UNITS || t in TENS || t === 'hundred' || t === 'thousand' || t === 'million');

/** Reads a number from the start of the tokens (digits or words). */
export function parseNumberPrefix(tokens: string[]): { value: number; used: number } | null {
  const first = tokens[0];
  if (first === undefined) return null;
  const digits = first.replace(/,/g, '');
  if (/^\d+(\.\d+)?$/.test(digits)) {
    // "5 thousand" style
    if (tokens[1] === 'thousand') return { value: parseFloat(digits) * 1000, used: 2 };
    return { value: parseFloat(digits), used: 1 };
  }
  const k = /^(\d+(?:\.\d+)?)k$/.exec(digits);
  if (k) return { value: parseFloat(k[1]!) * 1000, used: 1 };
  if (!isNumWord(first)) return null;

  let total = 0;
  let current = 0;
  let used = 0;
  let sawAny = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t in UNITS) {
      // "a"/"an" only count as a number at the very start
      if ((t === 'a' || t === 'an') && i > 0) break;
      current += UNITS[t]!;
    } else if (t in TENS) current += TENS[t]!;
    else if (t === 'hundred') current = (current || 1) * 100;
    else if (t === 'thousand') { total += (current || 1) * 1000; current = 0; }
    else if (t === 'million') { total += (current || 1) * 1_000_000; current = 0; }
    else if (t === 'and' && sawAny && isNumWord(tokens[i + 1]) && !(tokens[i + 1] === 'a' || tokens[i + 1] === 'an')) {
      used++;
      continue;
    } else break;
    sawAny = true;
    used++;
  }
  // don't swallow a trailing "and"
  if (tokens[used - 1] === 'and') used--;
  return { value: total + current, used };
}

const UNIT_WORDS = new Set([
  'bag', 'bags', 'carton', 'cartons', 'cartoon', 'cartoons', 'piece', 'pieces', 'pcs', 'pc', 'unit', 'units', 'bottle', 'bottles',
  'pack', 'packs', 'packet', 'packets', 'crate', 'crates', 'kg', 'litre', 'litres', 'liter', 'liters',
  'sachet', 'sachets', 'can', 'cans', 'box', 'boxes', 'dozen', 'tin', 'tins', 'bundle', 'bundles', 'sack', 'sacks',
]);

// (No regex lookbehind anywhere in this file: Safari before 16.4 cannot even load a script that contains one.)
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

/** Turns commas that are not inside a number ("1,500") into " and ", so lists can be split on one separator. */
const commasToAnd = (text: string): string => text.replace(/,/g, (ch, at: number, all: string) => (isDigit(all[at - 1]) && isDigit(all[at + 1]) ? ch : ' and '));

export function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[₦$£€]/g, ' ')
    .replace(/\bnaira\b/g, ' ')
    .replace(/[^a-z0-9.,\s']/g, ' ')
    .replace(/[.,]/g, (ch, at: number, all: string) => (isDigit(all[at - 1]) && isDigit(all[at + 1]) ? ch : ' ')) // keep . and , only inside numbers (1.5, 1,500)
    .replace(/\s+/g, ' ')
    .trim();
}

// Speech recognisers often write "sell" as "cell"/"sale" and "add" as "at"/"ad". Only fixed when a
// quantity follows, so ordinary sentences are left alone.
const QTY_AHEAD = `(?=\\d|(?:${[...Object.keys(UNITS).filter((w) => w !== 'a' && w !== 'an'), ...Object.keys(TENS)].join('|')})\\b)`;
const SELL_SLIPS = new RegExp(`^(?:cell|sale|sail|sel|sill|sells)\\s+(?=a\\s|an\\s|${QTY_AHEAD.slice(3, -1)})`);
const ADD_SLIPS = new RegExp(`^(?:at|ad|add)\\s+${QTY_AHEAD}`);

const FILLER = /^(?:(?:please|pls|hey|ok|okay|assistant|can you|could you|i want to|i wanna|i'd like to|go ahead and|let's|lets)\s+)+/;

function parseItem(part: string): ItemSpec | null {
  // "50kg of rice" (number and unit run together) -> "50 kg of rice"
  const tokens = part
    .split(' ')
    .filter(Boolean)
    .flatMap((tok, i) => {
      const m = i === 0 ? /^(\d+(?:\.\d+)?)([a-z]+)$/.exec(tok) : null;
      return m && UNIT_WORDS.has(m[2]!) ? [m[1]!, m[2]!] : [tok];
    });
  if (tokens.length === 0) return null;
  let qty = 1;
  let i = 0;
  const num = parseNumberPrefix(tokens);
  if (num) {
    qty = num.value;
    i = num.used;
  }
  let unit: string | undefined;
  if (tokens[i] && UNIT_WORDS.has(tokens[i]!)) {
    unit = tokens[i];
    i++;
  }
  if (tokens[i] === 'of') i++;
  let name = tokens.slice(i).join(' ').trim();
  if (!name && unit) name = unit; // "two bags" -> product called "bags"
  if (!name) return null;
  return { qty, unit, name };
}

export function parseItems(text: string): ItemSpec[] {
  return commasToAnd(text)
    .split(/\s*(?: and | plus | with )\s*/)
    .map((p) => parseItem(p.trim()))
    .filter((x): x is ItemSpec => x !== null);
}

/** Items with an optional price each: "20 bags of rice at 41000 each and 10 coke at 220". */
export function parsePurchaseItems(text: string): ItemSpec[] {
  return commasToAnd(text)
    .split(/\s*(?: and | plus )\s*/)
    .map((part) => {
      const tokens = part.trim().split(' ').filter(Boolean);
      // the last "at"/"for" that is followed by a number reads as the unit price
      for (let i = tokens.length - 2; i > 0; i--) {
        if (tokens[i] !== 'at' && tokens[i] !== 'for') continue;
        const n = parseNumberPrefix(tokens.slice(i + 1));
        if (!n) continue;
        const tail = tokens.slice(i + 1 + n.used);
        if (tail.length && !/^(?:each|apiece|per|a|every)$/.test(tail[0]!)) continue;
        const item = parseItem(tokens.slice(0, i).join(' '));
        return item ? { ...item, cost: n.value } : null;
      }
      return parseItem(part.trim());
    })
    .filter((x): x is ItemSpec => x !== null);
}

/** Pulls "paid 500000" / "paid in full" / "on credit" and a trailing "at 41000 each" out of what follows "from". */
function parsePurchaseTail(rest: string): { supplier: string; paid?: number | 'full'; cost?: number } {
  let tokens = rest.split(' ').filter(Boolean);
  let paid: number | 'full' | undefined;
  let cost: number | undefined;
  const cut = (from: number, count: number): void => {
    if (tokens[from - 1] === 'and') { from--; count++; }
    tokens = [...tokens.slice(0, from), ...tokens.slice(from + count)];
  };
  const credit = tokens.join(' ').match(/\b(?:on credit|pay later|paying later|not paid|unpaid|no payment|owing|on account)\b/);
  if (credit) {
    const words = credit[0].split(' ').length;
    const at = tokens.join(' ').slice(0, credit.index).split(' ').filter(Boolean).length;
    cut(at, words);
    paid = 0;
  }
  const pi = tokens.indexOf('paid');
  if (pi >= 0) {
    const after = tokens.slice(pi + 1);
    if (/^(?:in|full|all|everything|fully)$/.test(after[0] ?? '')) {
      cut(pi, 1 + (after[0] === 'in' ? 2 : 1));
      paid = 'full';
    } else {
      const n = parseNumberPrefix(after);
      if (n) {
        cut(pi, 1 + n.used);
        paid = n.value;
      }
    }
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] !== 'at' && tokens[i] !== 'for') continue;
    const n = parseNumberPrefix(tokens.slice(i + 1));
    if (!n) continue;
    let used = 1 + n.used;
    if (/^(?:each|apiece)$/.test(tokens[i + 1 + n.used] ?? '')) used++;
    cut(i, used);
    cost = n.value;
    break;
  }
  return { supplier: tokens.join(' ').trim(), paid, cost };
}

const PAYMENTS = /\b(?:(?:in|on|by|with|via|through|using)\s+)?(cash|transfer|pos|card|credit)(?:\s+payment)?\b/;

export function parseCommand(raw: string): Intent {
  let t = normalize(raw);
  t = t.replace(FILLER, '').trim();
  if (!t) return { type: 'unknown' };
  t = t.replace(SELL_SLIPS, 'sell ').replace(ADD_SLIPS, 'add ');

  if (/^(yes|yeah|yep|yup|confirm|confirmed|okay|ok|go ahead|do it|correct|proceed|sure|that'?s right)\b/.test(t)) return { type: 'confirm' };
  if (/^(no|nope|cancel|stop|never ?mind|abort|wrong)\b/.test(t)) return { type: 'cancel' };
  if (/^(undo|reverse (?:that|the last|last)|take (?:that|it) back)\b/.test(t)) return { type: 'undo' };

  // set price
  let m = /^(?:change|set|update|make|edit)\s+(?:the\s+)?price\s+(?:of|for)\s+(.+?)\s+(?:to|at|as)\s+(.+)$/.exec(t);
  if (m) {
    const num = parseNumberPrefix(m[2]!.split(' '));
    if (num) return { type: 'set_price', product: m[1]!.trim(), price: num.value };
    return { type: 'unknown' };
  }
  m = /^(?:change|set|update|make)\s+(.+?)\s+price\s+(?:to|at|as)\s+(.+)$/.exec(t);
  if (m) {
    const num = parseNumberPrefix(m[2]!.split(' '));
    if (num) return { type: 'set_price', product: m[1]!.trim(), price: num.value };
    return { type: 'unknown' };
  }

  // suppliers: what is owed, and paying them (before "how much ..." is read as a stock question)
  m = /^(?:how much|what)\s+(?:do|did|am)\s+(?:i|we)\s+(?:still\s+)?(?:owe|owing)(?:\s+(?:to\s+)?(.+))?$/.exec(t) ?? /^(?:who do (?:i|we) owe|supplier (?:balance|balances|debts?))(?:\s+(.+))?$/.exec(t);
  if (m) return { type: 'supplier_balance', supplier: m[1]?.replace(/^(?:the|for|of)\s+/, '').trim() || undefined };
  m = /^(?:(?:i|we)\s+)?(?:pay|paid)\s+(.+)$/.exec(t);
  if (m) {
    const toks = m[1]!.replace(/^(?:the\s+)?/, '').split(' ').filter(Boolean);
    const first = parseNumberPrefix(toks);
    if (first) {
      const supplier = toks.slice(first.used).join(' ').replace(/^(?:to|for)\s+/, '').trim();
      if (supplier) return { type: 'pay_supplier', supplier, amount: first.value };
    }
    for (let i = 1; i < toks.length; i++) {
      const n = parseNumberPrefix(toks.slice(i));
      if (n && n.used === toks.length - i) {
        const supplier = toks.slice(0, i).join(' ').replace(/\s+(?:to|the)$/, '').trim();
        if (supplier) return { type: 'pay_supplier', supplier, amount: n.value };
      }
    }
    return { type: 'unknown' };
  }

  // reports
  if (/\bexpir(?:e|es|ed|ing|y)\b|\bgoing (?:bad|off)\b|\bpast (?:their |its )?(?:date|expiry)\b|\bout of date\b/.test(t) && !/\b(?:add|set|receive|sell|sold)\b/.test(t)) {
    return { type: 'expiring' };
  }
  if (/\blow\b.*\bstock\b|\bstock\b.*\blow\b|running (?:low|out)|(?:what|which).*(?:finish|finishing|out of stock|almost done|low)/.test(t)) {
    return { type: 'low_stock' };
  }
  if (/(?:what|how much).*\b(?:sold|sell|sales|made)\b|\b(?:today'?s|sales)\s+(?:sales|report|total|today)|sales report/.test(t)) {
    return { type: 'report_today' };
  }

  // check stock
  m =
    /^(?:how many|how much)\s+(.+?)\s+(?:do i have|do we have|have i got|are there|is there|are left|is left|are remaining|is remaining|remain|left|remaining|in stock)\b.*$/.exec(t) ??
    /^(?:check|show|what is|what's|whats|get)\s+(?:me\s+)?(?:the\s+)?(?:stock|inventory|quantity|balance)\s+(?:of|for|on)\s+(.+)$/.exec(t) ??
    /^(?:stock|inventory)\s+(?:of|for)\s+(.+)$/.exec(t) ??
    /^(?:do i have|do we have|is there)\s+(?:any\s+)?(.+?)(?:\s+(?:in stock|left|remaining))?$/.exec(t) ??
    /^(?:how many|how much)\s+(.+)$/.exec(t);
  if (m) {
    const product = m[1]!.replace(/^(?:of|the)\s+/, '').trim();
    if (product) return { type: 'check_stock', product };
  }

  // moving goods between shops
  m = /^(?:transfer|send|move|ship)\s+(.+?)\s+to\s+(.+)$/.exec(t);
  if (m) {
    const items = parseItems(m[1]!);
    const shop = m[2]!.replace(/^(?:the\s+)?/, '').trim();
    if (items.length && shop) return { type: 'transfer', items, shop };
  }
  m =
    /^(?:receive|received)\s+(?:the\s+)?(?:transfer|delivery|goods)(?:\s+from\s+(.+))?$/.exec(t) ??
    /^(?:the\s+)?(?:transfer|delivery|goods|stock)\s+(?:has\s+|have\s+)?(?:arrived|came|is here|are here|received)(?:\s+from\s+(.+))?$/.exec(t);
  if (m) return { type: 'receive_transfer', from: m[1]?.trim() || undefined };

  // goods bought from a supplier (before the plain "received 20 rice" below, which has no supplier)
  m = /^(?:received|receive|bought|buy|purchased|purchase|restocked|restock|record (?:a )?purchase of)\s+(.+?)\s+from\s+(.+)$/.exec(t);
  if (m) {
    const items = parsePurchaseItems(m[1]!);
    const tail = parsePurchaseTail(m[2]!);
    if (items.length && tail.supplier) {
      if (tail.cost !== undefined) for (const it of items) if (it.cost === undefined) it.cost = tail.cost;
      return { type: 'receive_purchase', items, supplier: tail.supplier, paid: tail.paid };
    }
  }

  // add stock
  m = /^(?:add|received|receive|restock|stock in|put in|record purchase of|bought)\s+(.+?)(?:\s+(?:(?:to|into|in)\s+(?:the\s+)?)?(?:stock|inventory|store))?$/.exec(t);
  if (m) {
    const items = parseItems(m[1]!);
    if (items.length) return { type: 'add_stock', items };
  }

  // sell
  m = /^(?:sell|sold|i sold|we sold|ring up|record sale of|record a sale of|make a sale of)\s+(.+)$/.exec(t);
  if (m) {
    let rest = m[1]!;
    let payment: string | undefined;
    const pm = PAYMENTS.exec(rest);
    if (pm) {
      payment = pm[1];
      rest = (rest.slice(0, pm.index) + ' ' + rest.slice(pm.index + pm[0].length)).replace(/\s+/g, ' ').trim();
    }
    let customer: string | undefined;
    const ci = rest.lastIndexOf(' to ');
    if (ci > 0) {
      customer = rest.slice(ci + 4).trim() || undefined;
      rest = rest.slice(0, ci).trim();
    }
    const items = parseItems(rest);
    if (items.length) return { type: 'sell', items, customer, payment };
  }

  return { type: 'unknown' };
}
