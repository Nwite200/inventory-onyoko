// A small ESC/POS encoder: the command set almost every receipt printer understands.
// Text is limited to plain ASCII (accents removed, ₦ becomes N) because printers differ in code pages
// and a wrong code page prints garbage; plain ASCII prints correctly on all of them.

/** Makes text safe for any printer: ₦ -> N, accents removed, anything else unprintable -> ?. */
export function ascii(s: string): string {
  const map: Record<string, string> = {
    '₦': 'N', '€': 'EUR', '£': 'GBP', '×': 'x', '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '•': '*',
  };
  let out = '';
  for (const ch of s.normalize('NFD')) {
    if (/[̀-ͯ]/.test(ch)) continue; // combining accent marks
    if (/[    ]/.test(ch)) out += ' ';
    else if (map[ch]) out += map[ch];
    else if (ch === '\n' || (ch >= ' ' && ch <= '~')) out += ch;
    else out += '?';
  }
  return out;
}

/** Breaks text into lines of at most `width` characters, on spaces where possible. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of ascii(text).split('\n')) {
    let line = '';
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (word.length > width) {
        // a single word longer than the paper: cut it
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ' ' + word;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export class EscPos {
  private out: number[] = [];
  /** Characters per line at normal size: 32 for 58mm paper, 48 for 80mm. */
  readonly width: number;

  constructor(width = 32) {
    this.width = width;
  }

  private push(...b: number[]): this {
    this.out.push(...b);
    return this;
  }

  init(): this { return this.push(ESC, 0x40); }
  align(a: 'left' | 'center' | 'right'): this { return this.push(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2); }
  bold(on: boolean): this { return this.push(ESC, 0x45, on ? 1 : 0); }
  /** Character size multipliers 1..4 (width, height). */
  size(w = 1, h = 1): this { return this.push(GS, 0x21, ((Math.min(4, Math.max(1, w)) - 1) << 4) | (Math.min(4, Math.max(1, h)) - 1)); }
  feed(lines = 1): this { return this.push(ESC, 0x64, Math.min(255, Math.max(0, lines))); }
  /** Partial cut after feeding the paper past the blade. */
  cut(): this { return this.push(GS, 0x56, 0x42, 0x03); }
  /** Pulses pin 2: opens a cash drawer plugged into the printer. */
  openDrawer(): this { return this.push(ESC, 0x70, 0x00, 0x19, 0xfa); }

  /**
   * Prints a Code 128 barcode with the printer's own barcode engine (GS k 73, subset B).
   * width 2..6 = module width in dots; height in dots; the text under the bars is printed by the printer.
   */
  barcode(text: string, opts: { height?: number; width?: number; textBelow?: boolean } = {}): this {
    const data = '{B' + ascii(text).replace(/[^\x20-\x7e]/g, '?');
    if (data.length > 82) throw new Error('Barcode text is too long');
    this.push(GS, 0x68, Math.min(255, Math.max(1, opts.height ?? 60))); // height
    this.push(GS, 0x77, Math.min(6, Math.max(2, opts.width ?? 2))); // module width
    this.push(GS, 0x48, opts.textBelow === false ? 0 : 2); // text under the bars (or none)
    this.push(GS, 0x6b, 73, data.length);
    for (const ch of data) this.out.push(ch.charCodeAt(0));
    return this;
  }

  /** Writes text (no line break added). */
  text(s: string): this {
    for (const ch of ascii(s)) this.out.push(ch === '\n' ? LF : ch.charCodeAt(0));
    return this;
  }
  line(s = ''): this { return this.text(s).push(LF); }
  rule(ch = '-'): this { return this.line(ch.repeat(this.width)); }

  /** Wrapped text, one printer line each. `chars` is how many characters fit (smaller when the text is enlarged). */
  paragraph(s: string, chars = this.width): this {
    for (const l of wrap(s, chars)) this.line(l);
    return this;
  }

  /** Left text and right text on the same line (e.g. an item name and its price). A long left side wraps. */
  columns(left: string, right: string): this {
    const r = ascii(right);
    const room = this.width - r.length - 1;
    if (room < 6) {
      this.paragraph(left);
      this.align('right').line(r).align('left');
      return this;
    }
    const parts = wrap(left, room);
    parts.forEach((p, i) => {
      if (i < parts.length - 1) this.line(p);
      else this.line(p + ' '.repeat(this.width - p.length - r.length) + r);
    });
    return this;
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}
