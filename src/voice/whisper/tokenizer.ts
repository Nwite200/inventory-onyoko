// Whisper's tokenizer (byte-level BPE) built from the model's tokens.txt: lines of "<base64 bytes> <id>".
// Decoding turns ids back into text. Encoding is used for the "hint" prompt that teaches the model the
// shop's own product names; it follows the standard merge rule: repeatedly join the adjacent pair whose
// joined bytes have the lowest id.

// the GPT-2 pre-tokenisation pattern
const SPLIT = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

const latin1 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
};

export class WhisperTokenizer {
  private byId = new Map<number, Uint8Array>();
  private rank = new Map<string, number>();

  constructor(tokensTxt: string) {
    for (const line of tokensTxt.split('\n')) {
      const sp = line.lastIndexOf(' ');
      if (sp <= 0) continue;
      const id = Number(line.slice(sp + 1));
      if (!Number.isInteger(id)) continue;
      const b64 = line.slice(0, sp);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      this.byId.set(id, bytes);
      this.rank.set(latin1(bytes), id);
    }
    if (this.byId.size < 1000) throw new Error('tokens.txt looks wrong (too few tokens)');
  }

  get size(): number {
    return this.byId.size;
  }

  /** Ids with no text entry (special tokens) are skipped. */
  decode(ids: number[]): string {
    const parts: Uint8Array[] = [];
    let total = 0;
    for (const id of ids) {
      const b = this.byId.get(id);
      if (b) {
        parts.push(b);
        total += b.length;
      }
    }
    const all = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      all.set(p, o);
      o += p.length;
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(all);
  }

  encode(text: string): number[] {
    const out: number[] = [];
    const enc = new TextEncoder();
    for (const piece of text.match(SPLIT) ?? []) {
      const bytes = enc.encode(piece);
      const whole = this.rank.get(latin1(bytes));
      if (whole !== undefined) {
        out.push(whole);
        continue;
      }
      let parts = Array.from(bytes, (b) => String.fromCharCode(b));
      for (;;) {
        let best = -1;
        let bestRank = Infinity;
        for (let i = 0; i < parts.length - 1; i++) {
          const r = this.rank.get(parts[i]! + parts[i + 1]!);
          if (r !== undefined && r < bestRank) {
            bestRank = r;
            best = i;
          }
        }
        if (best < 0) break;
        parts = [...parts.slice(0, best), parts[best]! + parts[best + 1]!, ...parts.slice(best + 2)];
      }
      for (const p of parts) {
        const r = this.rank.get(p);
        if (r !== undefined) out.push(r);
      }
    }
    return out;
  }
}
