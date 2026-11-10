// Reads the key/value metadata stored inside an .onnx file (ModelProto.metadata_props, field 14),
// without parsing the whole model. The Whisper exports store their sizes and special token ids there,
// so the app works with tiny / base / small models without any per-model settings.

export function readOnnxMetadata(buf: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const dec = new TextDecoder();
  let p = 0;

  const varint = (): number => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (p >= buf.length) throw new Error('Not a valid ONNX file (truncated)');
      const b = buf[p++]!;
      result += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return result;
      shift += 7;
      if (shift > 63) throw new Error('Not a valid ONNX file (bad number)');
    }
  };

  while (p < buf.length) {
    const tag = varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) varint();
    else if (wire === 1) p += 8;
    else if (wire === 5) p += 4;
    else if (wire === 2) {
      const len = varint();
      if (p + len > buf.length) throw new Error('Not a valid ONNX file (truncated)');
      if (field === 14) {
        // StringStringEntryProto { key = 1; value = 2 }
        const entry = buf.subarray(p, p + len);
        let q = 0;
        let key = '';
        let value = '';
        while (q < entry.length) {
          const t = entry[q++]!;
          let l = 0;
          let shift = 0;
          for (;;) {
            const b = entry[q++]!;
            l += (b & 0x7f) * 2 ** shift;
            if (!(b & 0x80)) break;
            shift += 7;
          }
          const text = dec.decode(entry.subarray(q, q + l));
          q += l;
          if (t >> 3 === 1) key = text;
          else if (t >> 3 === 2) value = text;
        }
        if (key) out[key] = value;
      }
      p += len;
    } else throw new Error('Not a valid ONNX file (unsupported field type)');
  }
  return out;
}
