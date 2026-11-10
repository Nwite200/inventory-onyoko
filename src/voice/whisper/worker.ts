/// <reference lib="webworker" />
// Runs the speech model off the main thread so the screen never freezes while it thinks.
import * as ort from 'onnxruntime-web/wasm';
import { fetchAsset, planAssets, pruneCache } from './assets';
import { WhisperModel, type OrtLike } from './model';

export type ToWorker =
  | { type: 'load'; modelBase: string; ortBase: string }
  | { type: 'transcribe'; id: number; audio: Float32Array; prompt?: string };

export type FromWorker =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string; confidence: number; ms: number }
  | { type: 'error'; id?: number; message: string };

const post = (m: FromWorker): void => self.postMessage(m);
let model: WhisperModel | undefined;
let loading: Promise<void> | undefined;

async function load(modelBase: string, ortBase: string): Promise<void> {
  if (model) return;
  const assets = await planAssets(modelBase, ortBase);
  const total = assets.reduce((s, a) => s + a.size, 0);
  let loaded = 0;
  const data: Record<string, Uint8Array> = {};
  for (const a of assets) {
    data[a.kind] = await fetchAsset(a, (n) => {
      loaded += n;
      post({ type: 'progress', loaded, total });
    });
  }
  await pruneCache(assets.map((a) => new URL(a.key, self.location.origin).pathname + new URL(a.key, self.location.origin).search));

  // The runtime files come from our own cache (as blob URLs), so nothing is fetched from the internet.
  const blob = (bytes: Uint8Array, type: string): string => URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  ort.env.wasm.wasmPaths = { mjs: blob(data['ort-mjs']!, 'text/javascript'), wasm: blob(data['ort-wasm']!, 'application/wasm') };
  ort.env.wasm.numThreads = 1; // multi-threading needs special server headers; one thread is fast enough for short commands
  ort.env.wasm.proxy = false;

  model = await WhisperModel.create(ort as unknown as OrtLike, {
    encoder: data.encoder!,
    decoder: data.decoder!,
    tokens: new TextDecoder().decode(data.tokens!),
  });
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      loading ??= load(m.modelBase, m.ortBase).finally(() => {
        loading = undefined;
      });
      await loading;
      post({ type: 'ready' });
    } else if (m.type === 'transcribe') {
      if (!model) throw new Error('The voice model is not loaded yet');
      const t0 = performance.now();
      const r = await model.transcribe(m.audio, { prompt: m.prompt });
      post({ type: 'result', id: m.id, text: r.text, confidence: r.confidence, ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    post({ type: 'error', id: m.type === 'transcribe' ? m.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
