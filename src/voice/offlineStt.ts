// Speech recognition that runs on this device: microphone -> speech detection -> Whisper (in a worker).
import { Endpointer } from './whisper/audio';
import { isInstalled, ModelMissingError, planAssets, removeInstalled } from './whisper/assets';
import { captureMic, micErrorMessage } from './mic';
import type { FromWorker, ToWorker } from './whisper/worker';
import type { SttEngine, SttHandlers } from './speech';

const base = (): string => import.meta.env.BASE_URL ?? '/';
const MODEL_BASE = (): string => `${base()}models/whisper/`;
const ORT_BASE = (): string => `${base()}ort/`;

/** Below this average confidence the model is guessing; we ask the person to repeat instead of acting on it. */
export const MIN_CONFIDENCE = -1.5;

export interface Progress {
  loaded: number;
  total: number;
}

class OfflineSpeech {
  private worker?: Worker;
  private ready?: Promise<void>;
  private nextId = 1;
  private waiting = new Map<number, { resolve: (r: { text: string; confidence: number; ms: number }) => void; reject: (e: Error) => void }>();
  private onProgress?: (p: Progress) => void;
  private queue: Promise<unknown> = Promise.resolve();

  isBrowserSupported(): boolean {
    return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && typeof caches !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  /** Is the model stored on this device (so it works with no internet)? */
  installed(): Promise<boolean> {
    return isInstalled(MODEL_BASE(), ORT_BASE());
  }

  /** Does the server offer the model for download? Throws a readable message if not. */
  async availableOnServer(): Promise<{ sizeBytes: number }> {
    const assets = await planAssets(MODEL_BASE(), ORT_BASE()); // throws ModelMissingError
    return { sizeBytes: assets.reduce((s, a) => s + a.size, 0) };
  }

  /** Downloads (first time only) and loads the model. Safe to call repeatedly. */
  prepare(onProgress?: (p: Progress) => void): Promise<void> {
    if (onProgress) this.onProgress = onProgress;
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const w = new Worker(new URL('./whisper/worker.ts', import.meta.url), { type: 'module' });
      this.worker = w;
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.type === 'progress') this.onProgress?.({ loaded: m.loaded, total: m.total });
        else if (m.type === 'ready') resolve();
        else if (m.type === 'result') this.waiting.get(m.id)?.resolve({ text: m.text, confidence: m.confidence, ms: m.ms });
        else if (m.type === 'error') {
          if (m.id !== undefined) this.waiting.get(m.id)?.reject(new Error(m.message));
          else reject(new Error(m.message));
        }
        if (m.type === 'result' || (m.type === 'error' && m.id !== undefined)) this.waiting.delete(m.id!);
      };
      w.onerror = (e) => reject(new Error(e.message || 'The voice engine could not start'));
      const msg: ToWorker = { type: 'load', modelBase: MODEL_BASE(), ortBase: ORT_BASE() };
      w.postMessage(msg);
    });
    this.ready.catch(() => this.unload()); // allow a retry after a failed download
    return this.ready;
  }

  unload(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.ready = undefined;
    this.waiting.clear();
  }

  /** Frees the stored model (about 100 MB) from this device. */
  async remove(): Promise<void> {
    this.unload();
    await removeInstalled();
  }

  /** One recognition at a time (the worker is single-threaded). */
  transcribe(audio: Float32Array, prompt?: string): Promise<{ text: string; confidence: number; ms: number }> {
    const run = async () => {
      await this.prepare();
      const id = this.nextId++;
      return new Promise<{ text: string; confidence: number; ms: number }>((resolve, reject) => {
        this.waiting.set(id, { resolve, reject });
        const msg: ToWorker = { type: 'transcribe', id, audio, prompt };
        this.worker!.postMessage(msg, [audio.buffer]);
      });
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }
}

export const offlineSpeech = new OfflineSpeech();

export const offlineStt: SttEngine = {
  id: 'offline',
  name: 'On-device speech recognition (works without internet)',
  needsInternet: false,
  isSupported: () => offlineSpeech.isBrowserSupported(),
  start(_lang, h: SttHandlers, hint) {
    let stopped = false;
    let finished = false;
    let stopMic: (() => void) | undefined;
    const ep = new Endpointer();

    const finish = async (): Promise<void> => {
      if (finished) return;
      finished = true;
      stopMic?.();
      stopMic = undefined;
      const audio = ep.audio();
      if (audio.length < 4000) return h.onEnd('no-speech'); // under a quarter of a second
      h.onState?.('transcribing');
      try {
        const r = await offlineSpeech.transcribe(audio, hint);
        // noise sometimes comes out as a stray symbol or a single word; real commands have letters and low doubt
        if (!/[a-z]{2}/i.test(r.text) || r.confidence < MIN_CONFIDENCE) return h.onEnd('unclear');
        h.onText(r.text, true);
        h.onEnd();
      } catch (e) {
        h.onEnd(e instanceof Error ? e.message : 'Voice recognition failed');
      }
    };

    void (async () => {
      try {
        h.onState?.('loading');
        await offlineSpeech.prepare();
        if (stopped) return h.onEnd();
        stopMic = await captureMic((chunk) => {
          if (finished) return;
          const s = ep.push(chunk);
          h.onLevel?.(ep.level);
          if (s === 'done' || s === 'no-speech') void finish();
        });
        if (stopped) {
          stopMic();
          return h.onEnd();
        }
        h.onState?.('listening');
      } catch (e) {
        if (e instanceof ModelMissingError) return h.onEnd(e.message);
        const name = (e as { name?: string })?.name;
        h.onEnd(name && /Error$/.test(name) && name !== 'Error' ? micErrorMessage(e) : e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      stopped = true;
      // pressing stop while talking means "I'm done": use what was heard so far
      if (ep.state === 'speaking') void finish();
      else if (!finished) {
        finished = true;
        stopMic?.();
        h.onEnd();
      }
    };
  },
};
