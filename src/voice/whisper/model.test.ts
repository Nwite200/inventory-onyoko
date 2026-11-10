// These tests run the REAL speech model on real spoken audio. They need the model installed
// (npm run get-model); without it they are skipped, so a fresh checkout still passes.
import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web/wasm';
import { WhisperModel, type OrtLike } from './model';
import { readOnnxMetadata } from './onnxMeta';
import { WhisperTokenizer } from './tokenizer';
import { parseCommand } from '../parser';
import { MIN_CONFIDENCE } from '../offlineStt';

const DIR = process.env.OPENPOS_MODEL_DIR ?? 'public/models/whisper';
const have = existsSync(`${DIR}/encoder.onnx`) && existsSync(`${DIR}/decoder.onnx`) && existsSync(`${DIR}/tokens.txt`);
const HINT = 'Sell, add stock, how many, price, today, low stock. Rice 50kg Bag, Indomie Noodles Carton, Coke Bottle 50cl, Sugar 1kg, Mama Ade.';

function wav(name: string): Float32Array {
  const b = readFileSync(new URL(`./testdata/${name}.wav`, import.meta.url));
  const pcm = new Int16Array(b.buffer, b.byteOffset + 44, (b.length - 44) >> 1);
  return Float32Array.from(pcm, (x) => x / 32768);
}

describe.skipIf(!have)('real model on real audio', () => {
  let model: WhisperModel;
  let tokens: string;
  beforeAll(async () => {
    ort.env.wasm.numThreads = 1;
    tokens = readFileSync(`${DIR}/tokens.txt`, 'utf8');
    model = await WhisperModel.create(ort as unknown as OrtLike, {
      encoder: new Uint8Array(readFileSync(`${DIR}/encoder.onnx`)),
      decoder: new Uint8Array(readFileSync(`${DIR}/decoder.onnx`)),
      tokens,
    });
  }, 120000);

  it('reads the model\'s own settings from the file', () => {
    const meta = readOnnxMetadata(new Uint8Array(readFileSync(`${DIR}/encoder.onnx`)));
    expect(meta.n_mels).toBe('80');
    expect(Number(meta.n_text_layer)).toBeGreaterThan(0);
    expect(meta.eot).toBeTruthy();
  });

  it('tokenizer round-trips text, including names it has never seen', () => {
    const t = new WhisperTokenizer(tokens);
    for (const text of [' Sell two bags of rice to Mama Ade, cash.', ' Indomie Noodles Carton', ' Zobo ₦1,500 ünïcode']) {
      expect(t.decode(t.encode(text))).toBe(text);
    }
  });

  it.each([
    ['c1_kal', /^sell 2 bags of rice to .+ cash$/i, 'sell'],
    ['c2_slt', /^add 50 cartons of indomie to stock$/i, 'add_stock'],
    ['c3_kal', /^how many coke bottles do i have left$/i, 'check_stock'],
    ['c5_awb', /^change the price of sugar to 1500$/i, 'set_price'],
  ])('hears %s correctly and it becomes the right action', async (clip, expected, intent) => {
    const r = await model.transcribe(wav(clip!), { prompt: HINT });
    expect(r.text).toMatch(expected as RegExp);
    expect(r.confidence).toBeGreaterThan(MIN_CONFIDENCE);
    expect(parseCommand(r.text).type).toBe(intent);
  }, 120000);

  it('refuses to guess on sounds that are not speech', async () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
    const noise = Float32Array.from({ length: 48000 }, () => 0.2 * rnd());
    const tone = Float32Array.from({ length: 48000 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / 16000));
    for (const sound of [noise, tone]) {
      const r = await model.transcribe(sound, { prompt: HINT });
      expect(r.confidence).toBeLessThan(MIN_CONFIDENCE);
    }
  }, 120000);

  it('the hint helps: without it the shop\'s own words are often misspelled', async () => {
    const withHint = await model.transcribe(wav('c2_slt'), { prompt: HINT });
    expect(withHint.text.toLowerCase()).toContain('indomie');
  }, 120000);
});
