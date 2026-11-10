import { describe, expect, it, vi } from 'vitest';
import { EscPos, ascii, wrap } from './escpos';
import { buildSaleReceipt, buildTestPage, type ReceiptOptions } from './receipt';
import type { Sale } from '../db';

// ---- a mini printer: reads the bytes the way a real ESC/POS printer would -------------------------
interface Printed { text: string; align: string; bold: boolean; w: number; h: number }
function decode(bytes: Uint8Array) {
  const lines: Printed[] = [];
  const st = { align: 'left', bold: false, w: 1, h: 1 };
  let cur = '';
  let cut = false, drawer = false, init = 0, feed = 0, lastWasCutOrFeed = false;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x1b) {
      const c = bytes[++i]!;
      if (c === 0x40) { init++; st.align = 'left'; st.bold = false; st.w = st.h = 1; }
      else if (c === 0x61) st.align = ['left', 'center', 'right'][bytes[++i]!]!;
      else if (c === 0x45) st.bold = bytes[++i] === 1;
      else if (c === 0x64) feed += bytes[++i]!;
      else if (c === 0x70) { drawer = true; i += 3; }
      else throw new Error(`unknown ESC command 0x${c.toString(16)} at ${i}`);
    } else if (b === 0x1d) {
      const c = bytes[++i]!;
      if (c === 0x21) { const n = bytes[++i]!; st.w = (n >> 4) + 1; st.h = (n & 15) + 1; }
      else if (c === 0x56) { if (bytes[++i] !== 0x42) throw new Error('unexpected cut mode'); i++; cut = true; }
      else throw new Error(`unknown GS command 0x${c.toString(16)} at ${i}`);
    } else if (b === 0x0a) {
      lines.push({ text: cur, ...st });
      cur = '';
    } else if (b >= 0x20 && b <= 0x7e) cur += String.fromCharCode(b);
    else throw new Error(`non-printable/non-ASCII byte 0x${b.toString(16)} at ${i} would print as garbage`);
    lastWasCutOrFeed = cut || feed > 0;
  }
  void lastWasCutOrFeed;
  return { lines, cut, drawer, init, feed, trailing: cur };
}

const money = (n: number) => '₦' + n.toLocaleString('en-NG');
const sale = (over: Partial<Sale> = {}): Sale => ({
  id: 's1', number: 'INV-20261109-0007', at: Date.UTC(2026, 10, 9, 10, 30), customerName: 'Mama Ade', payment: 'cash',
  items: [{ productId: 'a', name: 'Rice 50kg Bag', qty: 2, price: 45000 }, { productId: 'b', name: 'Indomie Noodles Super Pack Carton (chicken flavour, long name)', qty: 3, price: 7500 }],
  total: 112500, status: 'completed', ...over,
});
const opts = (over: Partial<ReceiptOptions> = {}): ReceiptOptions => ({
  width: 32, businessName: 'Mama Ade Provisions', address: '12 Allen Avenue, Ikeja, Lagos', phone: '0803 000 0000', footer: 'Thank you! Come again.',
  shopName: 'Ikeja branch', cut: true, openDrawer: false, money, dateText: () => '09/11/2026, 11:30', ...over,
});

describe('text safety', () => {
  it('turns anything a printer could mangle into plain ASCII', () => {
    expect(ascii('₦1,500 × 2 – café “ok”')).toBe('N1,500 x 2 - cafe "ok"');
    expect(ascii('1 500 000')).toBe('1 500 000'); // the spaces some locales use inside numbers
    expect(ascii('Ọmọ 你好')).toBe('Omo ??'); // Yoruba dots are removed; characters it cannot print show as ?
  });
  it('wraps on spaces and cuts words longer than the paper', () => {
    expect(wrap('Indomie Noodles Carton', 12)).toEqual(['Indomie', 'Noodles', 'Carton']);
    expect(wrap('Supercalifragilistic', 8)).toEqual(['Supercal', 'ifragili', 'stic']);
  });
});

describe('ESC/POS commands', () => {
  it('encodes the standard command bytes', () => {
    const b = new EscPos(32).init().align('center').bold(true).size(2, 3).feed(2).cut().openDrawer().bytes();
    expect([...b]).toEqual([0x1b, 0x40, 0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x1d, 0x21, 0x12 /* width x2, height x3 -> (1<<4)|2 */, 0x1b, 0x64, 2, 0x1d, 0x56, 0x42, 0x03, 0x1b, 0x70, 0, 0x19, 0xfa]);
  });
  it('right-aligns the price on the same line, and wraps long names above it', () => {
    const d = decode(new EscPos(32).columns('Rice', 'N90,000').bytes());
    expect(d.lines[0]!.text).toHaveLength(32);
    expect(d.lines[0]!.text.startsWith('Rice')).toBe(true);
    expect(d.lines[0]!.text.endsWith('N90,000')).toBe(true);
    const long = decode(new EscPos(32).columns('Indomie Noodles Carton Chicken Flavour', 'N22,500').bytes());
    expect(long.lines.length).toBe(2);
    expect(long.lines.at(-1)!.text.endsWith('N22,500')).toBe(true);
    expect(long.lines.every((l) => l.text.length <= 32)).toBe(true);
  });
});

describe.each([[32], [48]])('receipt on %i-column paper', (width) => {
  const d = decode(buildSaleReceipt(sale(), opts({ width })));
  const text = d.lines.map((l) => l.text);

  it('starts with init, ends with feed + cut, prints only plain ASCII', () => {
    expect(d.init).toBe(1);
    expect(d.cut).toBe(true);
    expect(d.feed).toBeGreaterThanOrEqual(3);
    expect(d.trailing).toBe(''); // no half-written line left in the printer's buffer
  });
  it('never prints a line wider than the paper (counting enlarged text)', () => {
    for (const l of d.lines) expect(l.text.length * l.w).toBeLessThanOrEqual(width);
  });
  it('contains what the customer needs', () => {
    const all = text.join('\n');
    for (const s of ['Mama Ade Provisions', 'Ikeja branch', '12 Allen Avenue', 'Tel: 0803 000 0000', 'INV-20261109-0007', 'Customer: Mama Ade', 'Paid by: cash', 'Rice 50kg Bag', 'Thank you! Come again.']) {
      expect(all.replace(/\n/g, ' ')).toContain(s);
    }
    const total = d.lines.find((l) => l.text.startsWith('TOTAL'))!;
    expect(total.text.endsWith('N112,500')).toBe(true);
    expect(total.bold).toBe(true);
    // each item's amount is on its own line, right-aligned
    expect(text.some((t) => t.includes('2 x N45,000') && t.endsWith('N90,000'))).toBe(true);
    expect(text.some((t) => t.includes('3 x N7,500') && t.endsWith('N22,500'))).toBe(true);
  });
  it('centres the header, and the business name is bold and enlarged', () => {
    const name = d.lines[0]!;
    expect([name.align, name.bold, name.w, name.h]).toEqual(['center', true, 2, 2]);
  });
});

describe('receipt options', () => {
  it('opens the cash drawer only for cash sales that were completed', () => {
    expect(decode(buildSaleReceipt(sale(), opts({ openDrawer: true }))).drawer).toBe(true);
    expect(decode(buildSaleReceipt(sale({ payment: 'card' }), opts({ openDrawer: true }))).drawer).toBe(false);
    expect(decode(buildSaleReceipt(sale({ status: 'voided' }), opts({ openDrawer: true }))).drawer).toBe(false);
    expect(decode(buildSaleReceipt(sale(), opts({ openDrawer: false }))).drawer).toBe(false);
  });
  it('skips the cut for printers without a cutter, and marks voided sales', () => {
    expect(decode(buildSaleReceipt(sale(), opts({ cut: false }))).cut).toBe(false);
    expect(decode(buildSaleReceipt(sale({ status: 'voided' }), opts())).lines.some((l) => l.text === '*** VOIDED ***')).toBe(true);
  });
  it('a test page fits the paper', () => {
    const d = decode(buildTestPage({ width: 32, businessName: 'OpenPOS', cut: true }));
    for (const l of d.lines) expect(l.text.length * l.w).toBeLessThanOrEqual(32);
    expect(d.lines.some((l) => l.text === '12345678901234567890123456789012')).toBe(true);
  });
});

describe('USB and serial transports (against mocks, not real hardware)', () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });

  it('USB: finds the printer-class bulk OUT endpoint, claims it and sends in chunks', async () => {
    const sent: { ep: number; len: number }[] = [];
    const dev = {
      vendorId: 0x04b8, productId: 0x0e15, productName: 'TM-T20', opened: false,
      configuration: null as unknown,
      open: vi.fn(async () => { dev.opened = true; }),
      selectConfiguration: vi.fn(async () => { dev.configuration = { interfaces: [
        { interfaceNumber: 0, alternates: [{ interfaceClass: 3, endpoints: [{ endpointNumber: 1, direction: 'out', type: 'bulk' }] }] },
        { interfaceNumber: 1, alternates: [{ interfaceClass: 7, endpoints: [{ endpointNumber: 2, direction: 'in', type: 'bulk' }, { endpointNumber: 3, direction: 'out', type: 'bulk' }] }] },
      ] }; }),
      claimInterface: vi.fn(async () => undefined),
      transferOut: vi.fn(async (ep: number, d: Uint8Array) => { sent.push({ ep, len: d.length }); return { status: 'ok' }; }),
    };
    vi.stubGlobal('navigator', { usb: { requestDevice: async () => dev, getDevices: async () => [dev] } });
    const { connectPrinter, savedPrinter } = await import('./transport');
    const t = await connectPrinter('usb');
    expect(dev.claimInterface).toHaveBeenCalledWith(1); // the printer class, not the HID interface
    await t.write(new Uint8Array(10_000));
    expect(sent.map((s) => s.ep)).toEqual([3, 3, 3]);
    expect(sent.map((s) => s.len)).toEqual([4096, 4096, 1808]);
    // later (e.g. right after a sale) it is found again without asking
    const again = await savedPrinter('usb');
    expect(again?.label).toBe('TM-T20');
  });

  it('USB: reports a refusal from the printer instead of pretending it printed', async () => {
    const dev = {
      vendorId: 1, productId: 2, opened: true,
      configuration: { interfaces: [{ interfaceNumber: 0, alternates: [{ interfaceClass: 7, endpoints: [{ endpointNumber: 1, direction: 'out', type: 'bulk' }] }] }] },
      claimInterface: async () => undefined, transferOut: async () => ({ status: 'stall' }),
    };
    vi.stubGlobal('navigator', { usb: { requestDevice: async () => dev, getDevices: async () => [dev] } });
    const { connectPrinter } = await import('./transport');
    await expect((await connectPrinter('usb')).write(new Uint8Array(5))).rejects.toThrow(/did not accept/);
  });

  it('Serial: opens at the chosen speed, writes, and always releases the port', async () => {
    const written: number[] = [];
    const release = vi.fn();
    const port = {
      getInfo: () => ({ usbVendorId: 9, usbProductId: 9 }),
      open: vi.fn(async () => undefined),
      writable: { getWriter: () => ({ write: async (d: Uint8Array) => void written.push(d.length), releaseLock: release }) },
    };
    vi.stubGlobal('navigator', { serial: { requestPort: async () => port, getPorts: async () => [port] } });
    const { connectPrinter } = await import('./transport');
    const t = await connectPrinter('serial', 115200);
    expect(port.open).toHaveBeenCalledWith({ baudRate: 115200 });
    await t.write(new Uint8Array(5000));
    expect(written).toEqual([4096, 904]);
    expect(release).toHaveBeenCalled();
  });

  it('says so plainly when the browser has no printer support', async () => {
    vi.stubGlobal('navigator', {});
    const { connectPrinter } = await import('./transport');
    await expect(connectPrinter('usb')).rejects.toThrow(/Chrome or Edge/);
  });
});
