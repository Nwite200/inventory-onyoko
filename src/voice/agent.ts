// The voice agent: turns a transcript into an action, with confirmation, permissions, undo and audit.
// It calls the SAME functions as the screens (src/actions.ts) - there is no separate voice code path.
import { db, type Product } from '../db';
import * as A from '../actions';
import { config, formatMoney } from '../config';
import { currentLocationId, listLocations } from '../location';
import { payPurchase, receivePurchase, supplierBalances, voidPurchase } from '../purchases';
import { receiveTransfer, sendTransfer } from '../transfers';
import { parseCommand, type Intent, type ItemSpec } from './parser';
import { rank, resolveCustomer, resolveNamed, resolveProduct } from './matcher';
import type { LlmFallback } from './llm';

export type Role = 'cashier' | 'manager' | 'admin';

const ALLOWED: Record<string, Role[]> = {
  sell: ['cashier', 'manager', 'admin'],
  check_stock: ['cashier', 'manager', 'admin'],
  low_stock: ['cashier', 'manager', 'admin'],
  add_stock: ['manager', 'admin'],
  set_price: ['manager', 'admin'],
  report_today: ['manager', 'admin'],
  receive_purchase: ['manager', 'admin'],
  pay_supplier: ['manager', 'admin'],
  supplier_balance: ['manager', 'admin'],
  transfer: ['manager', 'admin'],
  receive_transfer: ['manager', 'admin'],
};

const CONFIRM_TTL_MS = 60_000;
const UNDO_TTL_MS = 60_000;

export interface AgentReply {
  text: string;
  /** Description of an action waiting for "yes", if any. */
  pending: string | null;
}

interface PendingAction {
  description: string;
  intent: string;
  createdAt: number;
  run: () => Promise<{ text: string; undo?: () => Promise<void>; undoLabel?: string }>;
}

interface Resolved {
  product: Product;
  qty: number;
  cost?: number;
}

const num = (n: number): string => n.toLocaleString('en', { maximumFractionDigits: 2 });
const titleCase = (s: string): string => s.replace(/\b\w/g, (c) => c.toUpperCase());
const orList = (ps: Product[]): string =>
  ps.map((p) => p.name).reduce((acc, n, i, arr) => (i === 0 ? n : i === arr.length - 1 ? `${acc}, or ${n}` : `${acc}, ${n}`), '');

function pickOption(raw: string, options: Product[]): Product | null {
  const t = raw.toLowerCase().trim();
  if (/^(?:the\s+)?(?:first|1st|one|1)\b/.test(t)) return options[0] ?? null;
  if (/^(?:the\s+)?(?:second|2nd|two|2)\b/.test(t)) return options[1] ?? null;
  if (/^(?:the\s+)?(?:third|3rd|three|3)\b/.test(t)) return options[2] ?? null;
  const r = rank(t.replace(/^(?:the|i mean|i said)\s+/, ''), options);
  if (r[0] && r[0].score >= 0.6 && (!r[1] || r[0].score - r[1].score >= 0.1)) return r[0].product;
  return null;
}

export class VoiceAgent {
  pending: PendingAction | null = null;
  private clarify: { options: Product[]; cont: (p: Product) => Promise<AgentReply> } | null = null;
  private last: { at: number; label: string; undo: () => Promise<void> } | null = null;
  private lastIntent = 'unknown';

  constructor(
    private getRole: () => Role,
    private llm?: LlmFallback,
  ) {}

  setFallback(llm?: LlmFallback): void {
    this.llm = llm;
  }

  async handle(raw: string, source: 'voice' | 'text' = 'voice'): Promise<AgentReply> {
    this.lastIntent = 'unknown';
    let reply: AgentReply;
    try {
      reply = await this.route(raw);
    } catch (err) {
      reply = this.say(err instanceof Error ? err.message : 'Something went wrong.');
    }
    await A.logAudit({ source, transcript: raw, intent: this.lastIntent, result: reply.text, role: this.getRole() });
    return reply;
  }

  private say(text: string): AgentReply {
    return { text, pending: this.activePending()?.description ?? null };
  }

  private activePending(): PendingAction | null {
    if (this.pending && Date.now() - this.pending.createdAt > CONFIRM_TTL_MS) this.pending = null;
    return this.pending;
  }

  private async route(raw: string): Promise<AgentReply> {
    let intent: Intent = parseCommand(raw);

    // answering "did you mean A or B?"
    if (this.clarify) {
      const c = this.clarify;
      this.clarify = null;
      const choice = intent.type === 'cancel' ? null : pickOption(raw, c.options);
      if (choice) {
        this.lastIntent = 'clarify';
        return c.cont(choice);
      }
      if (intent.type === 'cancel') {
        this.lastIntent = 'cancel';
        return this.say('Okay, cancelled.');
      }
      // otherwise treat it as a brand-new command
    }

    if (intent.type === 'unknown' && this.llm) {
      try {
        const viaLlm = await this.llm(raw);
        if (viaLlm) intent = viaLlm;
      } catch {
        /* offline or provider down: stay with rules only */
      }
    }
    this.lastIntent = intent.type;

    const allowed = ALLOWED[intent.type];
    if (allowed && !allowed.includes(this.getRole())) {
      return this.say(`Your role (${this.getRole()}) is not allowed to do that.`);
    }

    if ((intent.type === 'receive_purchase' || intent.type === 'pay_supplier' || intent.type === 'supplier_balance') && !config.features.purchases) {
      return this.say('Purchases and suppliers are switched off in Settings.');
    }
    if ((intent.type === 'transfer' || intent.type === 'receive_transfer') && !config.features.transfers) {
      return this.say('Transfers between shops are switched off in Settings.');
    }

    switch (intent.type) {
      case 'confirm':
        return this.confirm();
      case 'cancel':
        if (this.activePending()) {
          this.pending = null;
          return this.say('Cancelled.');
        }
        return this.say('Nothing to cancel.');
      case 'undo':
        return this.undo();
      case 'check_stock':
        return this.checkStock(intent.product);
      case 'low_stock':
        return this.lowStock();
      case 'report_today':
        return this.reportToday();
      case 'sell':
        return this.prepareSell(intent);
      case 'add_stock':
        return this.prepareAddStock(intent.items);
      case 'set_price':
        return this.prepareSetPrice(intent.product, intent.price);
      case 'receive_purchase':
        return this.prepareReceivePurchase(intent);
      case 'pay_supplier':
        return this.preparePaySupplier(intent.supplier, intent.amount);
      case 'supplier_balance':
        return this.supplierOwed(intent.supplier);
      case 'transfer':
        return this.prepareTransfer(intent.items, intent.shop);
      case 'receive_transfer':
        return this.prepareReceiveTransfer(intent.from);
      default:
        return this.say("Sorry, I didn't get that. Try: \"sell two rice to Mama Ade cash\", \"add fifty indomie\", or \"how many coke do I have\".");
    }
  }

  // ---- resolving spoken names -------------------------------------------------

  private async resolveSpecs(specs: ItemSpec[], done: (items: Resolved[]) => Promise<AgentReply>): Promise<AgentReply> {
    const products = await db.products.toArray();
    const resolved: Resolved[] = [];
    const step = async (i: number): Promise<AgentReply> => {
      if (i >= specs.length) return done(resolved);
      const s = specs[i]!;
      const r = resolveProduct(s.name, products);
      if (r.status === 'none') return this.say(`I couldn't find "${s.name}" in your products.`);
      if (r.status === 'ambiguous') {
        this.clarify = {
          options: r.options,
          cont: async (p) => {
            resolved.push({ product: p, qty: s.qty, cost: s.cost });
            return step(i + 1);
          },
        };
        return this.say(`Did you mean ${orList(r.options)}?`);
      }
      resolved.push({ product: r.product, qty: s.qty, cost: s.cost });
      return step(i + 1);
    };
    return step(0);
  }

  private setPending(p: Omit<PendingAction, 'createdAt'>): AgentReply {
    this.pending = { ...p, createdAt: Date.now() };
    return { text: `${p.description} Confirm?`, pending: p.description };
  }

  // ---- read-only intents (run immediately) -----------------------------------------

  private async checkStock(query: string): Promise<AgentReply> {
    const products = await db.products.toArray();
    const r = resolveProduct(query, products);
    const show = (p: Product): AgentReply =>
      this.say(`${p.name}: ${num(p.stock)} ${p.unit}${p.stock === 1 ? '' : 's'} in stock${p.stock <= p.lowStockAt ? ' (running low)' : ''}.`);
    if (r.status === 'none') return this.say(`I couldn't find "${query}" in your products.`);
    if (r.status === 'match') return show(r.product);
    this.clarify = { options: r.options, cont: async (p) => show(p) };
    return this.say(`Did you mean ${orList(r.options)}?`);
  }

  private async lowStock(): Promise<AgentReply> {
    const low = await A.lowStock();
    if (!low.length) return this.say('Nothing is running low. Stock looks fine.');
    const list = low.slice(0, 5).map((p) => `${p.name} (${num(p.stock)})`).join(', ');
    return this.say(`${low.length} item${low.length > 1 ? 's' : ''} running low: ${list}.`);
  }

  private async reportToday(): Promise<AgentReply> {
    const s = await A.salesSummary(A.startOfDay());
    if (!s.count) return this.say('No sales yet today.');
    const top = s.top.slice(0, 3).map((t) => `${t.name} (${num(t.qty)})`).join(', ');
    return this.say(`Today: ${s.count} sale${s.count > 1 ? 's' : ''}, ${formatMoney(s.total)} total. Top sellers: ${top}.`);
  }

  // ---- write intents (need confirmation) ----------------------------------------------

  private async prepareSell(i: Extract<Intent, { type: 'sell' }>): Promise<AgentReply> {
    return this.resolveSpecs(i.items, async (items) => {
      let customerName = '';
      if (i.customer) {
        const existing = resolveCustomer(i.customer, await db.customers.toArray());
        customerName = existing ? existing.name : titleCase(i.customer);
      }
      const payment = i.payment ?? 'cash';
      const total = items.reduce((s, x) => s + x.qty * x.product.price, 0);
      const lines = items.map((x) => `${num(x.qty)} ${x.product.name}`).join(' and ');
      const who = customerName ? ` to ${customerName}` : '';
      return this.setPending({
        intent: 'sell',
        description: `Sell ${lines}${who}, ${formatMoney(total)} ${payment}.`,
        run: async () => {
          const sale = await A.checkout({
            items: items.map((x) => ({ productId: x.product.id, qty: x.qty })),
            customerName,
            payment,
          });
          return {
            text: `Done. Sale ${sale.number}, ${formatMoney(sale.total)}.`,
            undo: () => A.voidSale(sale.id),
            undoLabel: `sale ${sale.number}`,
          };
        },
      });
    });
  }

  private async prepareAddStock(specs: ItemSpec[]): Promise<AgentReply> {
    return this.resolveSpecs(specs, async (items) => {
      const lines = items.map((x) => `${num(x.qty)} ${x.product.name} (${num(x.product.stock)} to ${num(x.product.stock + x.qty)})`).join(', ');
      return this.setPending({
        intent: 'add_stock',
        description: `Add ${lines}.`,
        run: async () => {
          for (const x of items) await A.adjustStock(x.product.id, x.qty, 'voice');
          return {
            text: 'Stock updated.',
            undo: async () => {
              for (const x of items) await A.adjustStock(x.product.id, -x.qty, 'voice-undo');
            },
            undoLabel: 'the stock addition',
          };
        },
      });
    });
  }

  private async prepareSetPrice(query: string, price: number): Promise<AgentReply> {
    const products = await db.products.toArray();
    const r = resolveProduct(query, products);
    const build = (p: Product): AgentReply =>
      this.setPending({
        intent: 'set_price',
        description: `Change the price of ${p.name} from ${formatMoney(p.price)} to ${formatMoney(price)}.`,
        run: async () => {
          const old = p.price;
          await A.setPrice(p.id, price);
          return { text: `${p.name} is now ${formatMoney(price)}.`, undo: async () => void (await A.setPrice(p.id, old)), undoLabel: 'the price change' };
        },
      });
    if (r.status === 'none') return this.say(`I couldn't find "${query}" in your products.`);
    if (r.status === 'match') return build(r.product);
    this.clarify = { options: r.options, cont: async (p) => build(p) };
    return this.say(`Did you mean ${orList(r.options)}?`);
  }

  // ---- suppliers, purchases and transfers -----------------------------------------------------------

  private async supplierOwed(name?: string): Promise<AgentReply> {
    const balances = await supplierBalances();
    if (name) {
      const s = resolveNamed(name, balances.map((b) => ({ ...b, name: b.supplier.name })));
      if (!s) return this.say(`I couldn't find a supplier called "${name}".`);
      return this.say(s.owed > 0 ? `You owe ${s.supplier.name} ${formatMoney(s.owed)} (bought ${formatMoney(s.bought)}, paid ${formatMoney(s.paid)}).` : `You don't owe ${s.supplier.name} anything.`);
    }
    const owing = balances.filter((b) => b.owed > 0);
    if (!owing.length) return this.say("You don't owe any supplier.");
    const total = owing.reduce((s, b) => s + b.owed, 0);
    const list = owing.slice(0, 3).map((b) => `${b.supplier.name} ${formatMoney(b.owed)}`).join(', ');
    return this.say(`You owe ${formatMoney(total)} in total: ${list}${owing.length > 3 ? ` and ${owing.length - 3} more` : ''}.`);
  }

  private async prepareReceivePurchase(i: Extract<Intent, { type: 'receive_purchase' }>): Promise<AgentReply> {
    return this.resolveSpecs(i.items, async (items) => {
      const missing = items.filter((x) => x.cost === undefined && !(x.product.cost > 0));
      if (missing.length) {
        return this.say(`What did you pay for ${missing.map((x) => x.product.name).join(' and ')}? Say it with the price, like "received 20 ${missing[0]!.product.name} from ${titleCase(i.supplier)} at 41000 each".`);
      }
      const priced = items.map((x) => ({ ...x, cost: x.cost ?? x.product.cost }));
      const total = priced.reduce((s, x) => s + x.qty * x.cost, 0);
      const paid = i.paid === 'full' ? total : (i.paid ?? 0);
      if (paid > total) return this.say(`You said you paid ${formatMoney(paid)}, but these goods come to ${formatMoney(total)}.`);
      const existing = resolveNamed(i.supplier, await db.suppliers.toArray());
      const supplierName = existing ? existing.name : titleCase(i.supplier);
      const shop = (await listLocations()).find((l) => l.id === currentLocationId())?.name ?? 'this shop';
      const lines = priced.map((x) => `${num(x.qty)} ${x.product.name} at ${formatMoney(x.cost)}`).join(', ');
      const money = paid === 0 ? `nothing paid yet, so you will owe ${formatMoney(total)}` : paid === total ? 'paid in full' : `paid ${formatMoney(paid)}, owing ${formatMoney(total - paid)}`;
      return this.setPending({
        intent: 'receive_purchase',
        description: `Receive ${lines} from ${supplierName}${existing ? '' : ' (new supplier)'} into ${shop}. Total ${formatMoney(total)}, ${money}.`,
        run: async () => {
          const pur = await receivePurchase({
            supplierId: existing?.id,
            supplierName,
            items: priced.map((x) => ({ productId: x.product.id, qty: x.qty, cost: x.cost })),
            paid,
          });
          return { text: `Done. Purchase ${pur.number}, ${formatMoney(pur.total)}. Stock updated.`, undo: () => voidPurchase(pur.id), undoLabel: `purchase ${pur.number}` };
        },
      });
    });
  }

  private async preparePaySupplier(name: string, amount: number): Promise<AgentReply> {
    if (!(amount > 0)) return this.say('Say how much you are paying.');
    const balances = await supplierBalances();
    const s = resolveNamed(name, balances.map((b) => ({ ...b, name: b.supplier.name })));
    if (!s) return this.say(`I couldn't find a supplier called "${name}".`);
    if (s.owed <= 0) return this.say(`You don't owe ${s.supplier.name} anything.`);
    if (amount > s.owed) return this.say(`You only owe ${s.supplier.name} ${formatMoney(s.owed)}.`);
    return this.setPending({
      intent: 'pay_supplier',
      description: `Pay ${s.supplier.name} ${formatMoney(amount)}. You owe ${formatMoney(s.owed)}, so ${formatMoney(s.owed - amount)} will remain.`,
      run: async () => {
        // pay the oldest unpaid purchases first
        let left = amount;
        const open = (await db.purchases.where('supplierId').equals(s.supplier.id).toArray())
          .filter((p) => p.status === 'received' && p.total - p.paid > 0.0001)
          .sort((x, y) => x.at - y.at);
        for (const p of open) {
          if (left <= 0.0001) break;
          const part = Math.min(left, p.total - p.paid);
          await payPurchase(p.id, part);
          left -= part;
        }
        // no undo: a payment is corrected from the Purchases screen
        return { text: `Recorded: paid ${s.supplier.name} ${formatMoney(amount)}. A mistaken payment cannot be undone by voice.` };
      },
    });
  }

  private async prepareTransfer(specs: ItemSpec[], shopSpoken: string): Promise<AgentReply> {
    const here = currentLocationId();
    const locs = await listLocations();
    const others = locs.filter((l) => l.id !== here);
    if (!others.length) return this.say('You only have one shop. The owner can add another in Settings.');
    const to = resolveNamed(shopSpoken, others);
    if (!to) return this.say(`I couldn't find a shop called "${shopSpoken}". Your other shops: ${others.map((l) => l.name).join(', ')}.`);
    const from = locs.find((l) => l.id === here)?.name ?? 'this shop';
    return this.resolveSpecs(specs, async (items) => {
      for (const x of items) {
        if (x.product.stock < x.qty && !config.allowNegativeStock) return this.say(`You only have ${num(x.product.stock)} ${x.product.name} in ${from}.`);
      }
      const lines = items.map((x) => `${num(x.qty)} ${x.product.name}`).join(' and ');
      return this.setPending({
        intent: 'transfer',
        description: `Send ${lines} from ${from} to ${to.name}. It leaves ${from} now and counts in ${to.name} when they confirm it arrived.`,
        run: async () => {
          const t = await sendTransfer({ toLocationId: to.id, items: items.map((x) => ({ productId: x.product.id, qty: x.qty })) });
          // no undo: once sent, the other shop owns it; they can send it back
          return { text: `Sent ${t.number} to ${to.name}. A transfer cannot be undone by voice.` };
        },
      });
    });
  }

  private async prepareReceiveTransfer(fromSpoken?: string): Promise<AgentReply> {
    const here = currentLocationId();
    const locs = await listLocations();
    const name = (id: string): string => locs.find((l) => l.id === id)?.name ?? id;
    let incoming = (await db.transfers.where('status').equals('sent').toArray()).filter((t) => t.toLocationId === here);
    if (fromSpoken) {
      const from = resolveNamed(fromSpoken, locs);
      if (!from) return this.say(`I couldn't find a shop called "${fromSpoken}".`);
      incoming = incoming.filter((t) => t.fromLocationId === from.id);
    }
    if (!incoming.length) return this.say('Nothing is on the way to this shop.');
    if (incoming.length > 1) {
      const list = incoming.map((t) => `${t.number} from ${name(t.fromLocationId)}`).join('; ');
      return this.say(`${incoming.length} transfers are on the way: ${list}. Say "receive transfer from" and the shop name, or use the Transfers screen.`);
    }
    const t = incoming[0]!;
    const lines = t.items.map((i) => `${num(i.qty)} ${i.name}`).join(', ');
    return this.setPending({
      intent: 'receive_transfer',
      description: `Confirm that ${lines} arrived from ${name(t.fromLocationId)} (${t.number}). It will be added to this shop's stock.`,
      run: async () => {
        await receiveTransfer(t.id);
        return { text: `Received ${t.number}. Stock updated.` };
      },
    });
  }

  // ---- confirm / undo ---------------------------------------------------------------------------

  private async confirm(): Promise<AgentReply> {
    const p = this.activePending();
    if (!p) return this.say('There is nothing to confirm.');
    this.pending = null;
    try {
      const out = await p.run();
      this.last = out.undo ? { at: Date.now(), label: out.undoLabel ?? 'that', undo: out.undo } : null;
      return this.say(out.text);
    } catch (err) {
      return this.say(`Could not do that: ${err instanceof Error ? err.message : 'unknown error'}.`);
    }
  }

  private async undo(): Promise<AgentReply> {
    if (!this.last) return this.say('There is nothing to undo.');
    if (Date.now() - this.last.at > UNDO_TTL_MS) {
      this.last = null;
      return this.say('That was more than a minute ago, so I cannot undo it by voice. Use the Sales screen instead.');
    }
    const l = this.last;
    this.last = null;
    try {
      await l.undo();
      return this.say(`Undone: ${l.label}.`);
    } catch (err) {
      return this.say(`Could not undo: ${err instanceof Error ? err.message : 'unknown error'}.`);
    }
  }
}
