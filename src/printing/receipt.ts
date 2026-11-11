// Lays a sale out as a receipt for a thermal printer.
import type { Sale } from '../db';
import { EscPos } from './escpos';

export interface ReceiptOptions {
  /** Characters per line: 32 (58mm paper) or 48 (80mm paper). */
  width: number;
  businessName: string;
  address?: string;
  phone?: string;
  footer?: string;
  shopName?: string;
  cut: boolean;
  openDrawer: boolean;
  money: (n: number) => string;
  dateText: (ts: number) => string;
}

export function buildSaleReceipt(sale: Sale, o: ReceiptOptions): Uint8Array {
  const p = new EscPos(o.width);
  p.init();
  if (o.openDrawer && sale.payment === 'cash' && sale.status === 'completed') p.openDrawer();

  p.align('center').bold(true).size(2, 2).paragraph(o.businessName, Math.floor(o.width / 2)).size(1, 1).bold(false);
  if (o.shopName) p.line(o.shopName);
  if (o.address) p.paragraph(o.address);
  if (o.phone) p.line(`Tel: ${o.phone}`);
  p.align('left').rule();

  p.line(`Receipt: ${sale.number}`);
  p.line(`Date: ${o.dateText(sale.at)}`);
  p.line(`Customer: ${sale.customerName}`);
  p.line(`Paid by: ${sale.payment}`);
  p.rule();

  for (const l of sale.items) {
    p.paragraph(l.name);
    p.columns(`  ${l.qty} x ${o.money(l.price)}`, o.money(l.qty * l.price));
  }
  p.rule();
  p.bold(true).size(1, 2).columns('TOTAL', o.money(sale.total)).size(1, 1).bold(false);
  p.rule();

  if (sale.status === 'voided') p.align('center').bold(true).line('*** VOIDED ***').bold(false);
  if (o.footer) p.align('center').paragraph(o.footer);
  p.align('left').feed(3);
  if (o.cut) p.cut();
  return p.bytes();
}

/** A short page for checking that the printer is connected and the paper width is right. */
export function buildTestPage(o: Pick<ReceiptOptions, 'width' | 'businessName' | 'cut'>): Uint8Array {
  const p = new EscPos(o.width);
  p.init().align('center').bold(true).size(2, 2).paragraph(o.businessName, Math.floor(o.width / 2)).size(1, 1).bold(false);
  p.line('Printer test').align('left').rule();
  p.line('1234567890'.repeat(5).slice(0, o.width));
  p.columns('Left side', 'Right side');
  p.line('Naira sign: ₦  (prints as N)');
  p.rule().align('center').line('If you can read this,').line('the printer works.').align('left').feed(3);
  if (o.cut) p.cut();
  return p.bytes();
}

/** One price label for a thermal printer: name, barcode (with its number under it) and price. */
export function buildLabel(
  item: { name: string; sku: string; price: number },
  o: { width: number; money: (n: number) => string; copies: number; cut: boolean },
): Uint8Array {
  const p = new EscPos(o.width);
  p.init();
  for (let i = 0; i < Math.max(1, Math.min(o.copies, 200)); i++) {
    p.align('center').bold(true).paragraph(item.name, o.width).bold(false);
    p.barcode(item.sku, { height: 60, width: o.width >= 48 ? 3 : 2 });
    p.line();
    p.bold(true).size(1, 2).line(o.money(item.price)).size(1, 1).bold(false);
    p.align('left').feed(2);
    if (o.cut) p.cut();
  }
  return p.bytes();
}
