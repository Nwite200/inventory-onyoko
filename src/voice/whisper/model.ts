// Runs a Whisper encoder/decoder pair (ONNX) and turns audio into text, entirely on the device.
// Works with the onnxruntime-web WASM build in a browser worker, and with the same package in Node (tests).
import { N_FRAMES, logMelSpectrogram } from './mel';
import { readOnnxMetadata } from './onnxMeta';
import { WhisperTokenizer } from './tokenizer';

export interface TensorLike {
  data: unknown;
  dims: readonly number[];
}
export interface SessionLike {
  run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>>;
}
export interface OrtLike {
  InferenceSession: { create(model: Uint8Array, options?: object): Promise<SessionLike> };
  Tensor: new (type: string, data: ArrayBufferView, dims: readonly number[]) => TensorLike;
}

export interface ModelFiles {
  encoder: Uint8Array;
  decoder: Uint8Array;
  tokens: string;
}

export interface TranscribeOptions {
  /** Words that are likely to be spoken (product names, shop commands). Improves spelling of rare names. */
  prompt?: string;
  maxNewTokens?: number;
}

export interface Transcript {
  text: string;
  /** Average log-probability of the words chosen. Near 0 = sure; below about -1 = probably guessing. */
  confidence: number;
  tokens: number[];
}

interface Meta {
  nMels: number;
  layers: number;
  ctx: number;
  state: number;
  vocab: number;
  sot: number;
  eot: number;
  noTimestamps: number;
  transcribe: number;
  sotPrev: number;
  multilingual: boolean;
  englishToken: number;
  suppress: Set<number>;
}

const num = (m: Record<string, string>, k: string): number => {
  const v = Number(m[k]);
  if (!Number.isFinite(v)) throw new Error(`Model metadata "${k}" is missing. Is this a Whisper model exported for sherpa-onnx?`);
  return v;
};

function parseMeta(m: Record<string, string>): Meta {
  const codes = (m.all_language_codes ?? '').split(',');
  const toks = (m.all_language_tokens ?? '').split(',').map(Number);
  const en = codes.indexOf('en');
  return {
    nMels: num(m, 'n_mels'),
    layers: num(m, 'n_text_layer'),
    ctx: num(m, 'n_text_ctx'),
    state: num(m, 'n_text_state'),
    vocab: num(m, 'n_vocab'),
    sot: num(m, 'sot'),
    eot: num(m, 'eot'),
    noTimestamps: num(m, 'no_timestamps'),
    transcribe: num(m, 'transcribe'),
    sotPrev: num(m, 'sot_prev'),
    multilingual: m.is_multilingual === '1',
    englishToken: en >= 0 ? (toks[en] ?? 50259) : 50259,
    suppress: new Set((m.non_speech_tokens ?? '').split(',').filter(Boolean).map(Number)),
  };
}

/** Removes things Whisper writes that are not speech: [BLANK_AUDIO], (music), *noise*, stray punctuation. */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪[^♪]*♪?/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,!?-]+|[\s.,!?-]+$/g, '')
    .trim();
}

export class WhisperModel {
  private constructor(
    private ort: OrtLike,
    private encoder: SessionLike,
    private decoder: SessionLike,
    private tok: WhisperTokenizer,
    private meta: Meta,
  ) {}

  static async create(ort: OrtLike, files: ModelFiles, sessionOptions: object = {}): Promise<WhisperModel> {
    const meta = parseMeta(readOnnxMetadata(files.encoder));
    const tok = new WhisperTokenizer(files.tokens);
    const encoder = await ort.InferenceSession.create(files.encoder, sessionOptions);
    const decoder = await ort.InferenceSession.create(files.decoder, sessionOptions);
    return new WhisperModel(ort, encoder, decoder, tok, meta);
  }

  encodePrompt(text: string): number[] {
    return this.tok.encode(text.startsWith(' ') ? text : ' ' + text);
  }

  async transcribe(audio: Float32Array, opts: TranscribeOptions = {}): Promise<Transcript> {
    const { ort, meta } = this;
    const { layers, ctx, state, vocab, eot } = meta;

    // 1. audio -> spectrogram -> encoder (once)
    const mel = logMelSpectrogram(audio, meta.nMels);
    const enc = await this.encoder.run({ mel: new ort.Tensor('float32', mel, [1, meta.nMels, N_FRAMES]) });
    const crossK = enc.n_layer_cross_k!;
    const crossV = enc.n_layer_cross_v!;

    // 2. starting tokens: optional hint prompt, then the transcription markers
    let promptIds = opts.prompt ? this.encodePrompt(opts.prompt) : [];
    promptIds = promptIds.slice(-(Math.floor(ctx / 2) - 1));
    const start = [
      ...(promptIds.length ? [meta.sotPrev, ...promptIds] : []),
      meta.sot,
      ...(meta.multilingual ? [meta.englishToken, meta.transcribe] : []),
      meta.noTimestamps,
    ];
    const maxNew = Math.min(opts.maxNewTokens ?? 96, ctx - start.length - 1);

    // 3. greedy decoding with the decoder's attention cache
    let selfK: TensorLike = new ort.Tensor('float32', new Float32Array(layers * ctx * state), [layers, 1, ctx, state]);
    let selfV: TensorLike = new ort.Tensor('float32', new Float32Array(layers * ctx * state), [layers, 1, ctx, state]);
    const out: number[] = [];
    let sumLogProb = 0;
    let input = start;
    let offset = 0;

    for (let step = 0; step < maxNew; step++) {
      const res = await this.decoder.run({
        tokens: new ort.Tensor('int64', BigInt64Array.from(input, (x) => BigInt(x)), [1, input.length]),
        in_n_layer_self_k_cache: selfK,
        in_n_layer_self_v_cache: selfV,
        n_layer_cross_k: crossK,
        n_layer_cross_v: crossV,
        offset: new ort.Tensor('int64', BigInt64Array.of(BigInt(offset)), [1]),
      });
      offset += input.length;
      selfK = res.out_n_layer_self_k_cache!;
      selfV = res.out_n_layer_self_v_cache!;

      const logits = res.logits!.data as Float32Array;
      const row = (input.length - 1) * vocab;

      let best = -1;
      let bestVal = -Infinity;
      let maxVal = -Infinity;
      for (let id = 0; id <= eot; id++) {
        // only text and the end marker are allowed; also no blank/empty first word, no non-speech symbols
        if (id === eot ? step === 0 : meta.suppress.has(id) || (step === 0 && id === 220)) continue;
        const v = logits[row + id]!;
        if (v > bestVal) {
          bestVal = v;
          best = id;
        }
      }
      for (let id = 0; id < vocab; id++) if (logits[row + id]! > maxVal) maxVal = logits[row + id]!;
      let z = 0;
      for (let id = 0; id < vocab; id++) z += Math.exp(logits[row + id]! - maxVal);
      const logProb = bestVal - maxVal - Math.log(z);

      if (best === eot || best < 0) break;
      out.push(best);
      sumLogProb += logProb;
      input = [best];

      // runaway repetition ("the the the the ...") means the model is guessing
      if (out.length >= 12 && new Set(out.slice(-12)).size <= 3) break;
    }

    return {
      text: cleanTranscript(this.tok.decode(out)),
      confidence: out.length ? sumLogProb / out.length : -10,
      tokens: out,
    };
  }
}
