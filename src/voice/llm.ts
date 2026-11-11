// Layer 2: LLM fallback for messy phrasing the rule parser cannot read.
// The model only returns a JSON intent; it never touches data. Every result is validated,
// then goes through the same confirmation flow as rule-parsed commands.
import { config } from '../config';
import type { Intent, ItemSpec } from './parser';

export type LlmFallback = (text: string) => Promise<Intent | null>;

const SYSTEM = `You convert a shop owner's spoken command into JSON. Reply with JSON only, no prose.
Schemas:
{"type":"sell","items":[{"qty":number,"name":string}],"customer":string|null,"payment":"cash"|"transfer"|"pos"|"card"|"credit"|null}
{"type":"add_stock","items":[{"qty":number,"name":string}]}
{"type":"check_stock","product":string}
{"type":"set_price","product":string,"price":number}
{"type":"report_today"}
{"type":"low_stock"}
{"type":"expiring"}
{"type":"receive_purchase","items":[{"qty":number,"name":string,"cost":number|null}],"supplier":string,"paid":number|"full"|null}
{"type":"pay_supplier","supplier":string,"amount":number}
{"type":"supplier_balance","supplier":string|null}
{"type":"transfer","items":[{"qty":number,"name":string}],"shop":string}
{"type":"receive_transfer","from":string|null}
{"type":"unknown"}
Understand English and Nigerian Pidgin. Never invent products. If unsure, return {"type":"unknown"}.`;

function validItems(x: unknown, withCost = false): ItemSpec[] | null {
  if (!Array.isArray(x) || x.length === 0) return null;
  const out: ItemSpec[] = [];
  for (const it of x) {
    if (!it || typeof it !== 'object') return null;
    const { qty, name, cost } = it as { qty?: unknown; name?: unknown; cost?: unknown };
    if (typeof qty !== 'number' || !(qty > 0) || qty > 100000 || typeof name !== 'string' || !name.trim()) return null;
    if (withCost && cost != null && (typeof cost !== 'number' || !(cost >= 0) || cost > 1e9)) return null;
    out.push({ qty, name: name.trim(), ...(withCost && typeof cost === 'number' ? { cost } : {}) });
  }
  return out;
}

export function validateIntent(x: unknown): Intent | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  switch (o.type) {
    case 'sell': {
      const items = validItems(o.items);
      if (!items) return null;
      return {
        type: 'sell',
        items,
        customer: typeof o.customer === 'string' && o.customer.trim() ? o.customer.trim() : undefined,
        payment: typeof o.payment === 'string' ? o.payment : undefined,
      };
    }
    case 'add_stock': {
      const items = validItems(o.items);
      return items ? { type: 'add_stock', items } : null;
    }
    case 'check_stock':
      return typeof o.product === 'string' && o.product.trim() ? { type: 'check_stock', product: o.product.trim() } : null;
    case 'set_price':
      return typeof o.product === 'string' && typeof o.price === 'number' && o.price >= 0
        ? { type: 'set_price', product: o.product.trim(), price: o.price }
        : null;
    case 'receive_purchase': {
      const items = validItems(o.items, true);
      const supplier = typeof o.supplier === 'string' ? o.supplier.trim() : '';
      if (!items || !supplier) return null;
      const paid = o.paid === 'full' ? 'full' : typeof o.paid === 'number' && o.paid >= 0 && o.paid <= 1e10 ? o.paid : undefined;
      return { type: 'receive_purchase', items, supplier, paid };
    }
    case 'pay_supplier':
      return typeof o.supplier === 'string' && o.supplier.trim() && typeof o.amount === 'number' && o.amount > 0 && o.amount <= 1e10
        ? { type: 'pay_supplier', supplier: o.supplier.trim(), amount: o.amount }
        : null;
    case 'supplier_balance':
      return { type: 'supplier_balance', supplier: typeof o.supplier === 'string' && o.supplier.trim() ? o.supplier.trim() : undefined };
    case 'transfer': {
      const items = validItems(o.items);
      return items && typeof o.shop === 'string' && o.shop.trim() ? { type: 'transfer', items, shop: o.shop.trim() } : null;
    }
    case 'receive_transfer':
      return { type: 'receive_transfer', from: typeof o.from === 'string' && o.from.trim() ? o.from.trim() : undefined };
    case 'report_today':
      return { type: 'report_today' };
    case 'low_stock':
      return { type: 'low_stock' };
    case 'expiring':
      return { type: 'expiring' };
    default:
      return null;
  }
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function ollamaFallback(baseUrl: string, model: string): LlmFallback {
  return async (text) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, system: SYSTEM, prompt: text, stream: false, format: 'json' }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    return validateIntent(extractJson(data.response ?? ''));
  };
}

export function geminiFallback(apiKey: string, model: string): LlmFallback {
  return async (text) => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return validateIntent(extractJson(data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''));
  };
}

/** Builds the fallback chosen in Settings (or undefined for rules-only). */
export function buildFallback(): LlmFallback | undefined {
  const l = config.llm;
  if (l.provider === 'ollama') return ollamaFallback(l.ollamaUrl, l.ollamaModel);
  if (l.provider === 'gemini' && l.geminiKey) return geminiFallback(l.geminiKey, l.geminiModel);
  return undefined;
}
