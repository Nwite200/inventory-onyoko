// Audio helpers for the offline speech engine. Pure functions/classes (no browser APIs) so they can be tested.
import { SAMPLE_RATE } from './mel';

/**
 * Converts a continuous stream from the microphone's own rate (44.1/48 kHz) to 16 kHz by averaging the
 * input over each output sample's span (a simple low-pass that avoids aliasing). Keeps its position
 * between calls, so chunk boundaries do not cause clicks.
 */
export class Resampler {
  private ratio: number;
  private tail = new Float32Array(0);
  private pos = 0;

  constructor(inRate: number, outRate = SAMPLE_RATE) {
    this.ratio = inRate / outRate;
  }

  process(chunk: Float32Array): Float32Array {
    if (this.ratio === 1) return chunk;
    const buf = new Float32Array(this.tail.length + chunk.length);
    buf.set(this.tail);
    buf.set(chunk, this.tail.length);
    const out: number[] = [];
    let pos = this.pos;
    while (pos + this.ratio <= buf.length) {
      const end = pos + this.ratio;
      let sum = 0;
      for (let i = Math.floor(pos); i < Math.ceil(end); i++) {
        const w = Math.min(i + 1, end) - Math.max(i, pos);
        sum += buf[i]! * w;
      }
      out.push(sum / this.ratio);
      pos = end;
    }
    const keep = Math.floor(pos);
    this.tail = buf.slice(keep);
    this.pos = pos - keep;
    return Float32Array.from(out);
  }
}

export type EndpointState = 'waiting' | 'speaking' | 'done' | 'no-speech';

export interface EndpointOptions {
  frameMs?: number;
  /** Quietest sound ever treated as speech (0..1 of full scale). */
  minLevel?: number;
  /** How much louder than the room noise speech must be. */
  noiseFactor?: number;
  /** Stop this long after the person falls silent. */
  endSilenceMs?: number;
  /** Give up if nobody speaks for this long. */
  noSpeechTimeoutMs?: number;
  /** Never record longer than this. */
  maxMs?: number;
  /** Shorter sounds (a cough, a click) are ignored. */
  minSpeechMs?: number;
  prerollMs?: number;
}

/**
 * Decides when someone starts and stops speaking, from 16 kHz audio chunks, so only the spoken part is
 * sent to the model. Compares each 20 ms frame's loudness with the room's background noise.
 */
export class Endpointer {
  state: EndpointState = 'waiting';
  /** Loudness of the latest frame, 0..1 (for a level meter). */
  level = 0;

  private o: Required<EndpointOptions>;
  private frameLen: number;
  private pending = new Float32Array(0);
  private preroll: Float32Array[] = [];
  private frames: Float32Array[] = [];
  private noise: number | undefined;
  private voicedRun = 0;
  private silenceRun = 0;
  private voicedFrames = 0;
  private waitedMs = 0;
  private totalMs = 0;

  constructor(options: EndpointOptions = {}) {
    this.o = {
      frameMs: 20,
      minLevel: 0.012,
      noiseFactor: 3,
      endSilenceMs: 1000,
      noSpeechTimeoutMs: 7000,
      maxMs: 15000,
      minSpeechMs: 160,
      prerollMs: 300,
      ...options,
    };
    this.frameLen = Math.round((SAMPLE_RATE * this.o.frameMs) / 1000);
  }

  push(chunk: Float32Array): EndpointState {
    if (this.finished()) return this.state;
    const buf = new Float32Array(this.pending.length + chunk.length);
    buf.set(this.pending);
    buf.set(chunk, this.pending.length);
    let p = 0;
    for (; p + this.frameLen <= buf.length; p += this.frameLen) {
      this.frame(buf.slice(p, p + this.frameLen));
      if (this.finished()) break;
    }
    this.pending = buf.slice(p);
    return this.state;
  }

  private finished(): boolean {
    return this.state === 'done' || this.state === 'no-speech';
  }

  private frame(f: Float32Array): void {
    let sq = 0;
    for (let i = 0; i < f.length; i++) sq += f[i]! * f[i]!;
    const rms = Math.sqrt(sq / f.length);
    this.level = Math.min(1, rms * 6);
    this.totalMs += this.o.frameMs;

    // background noise: drops to a quieter reading at once, rises only slowly
    this.noise = this.noise === undefined ? rms : Math.min(rms, this.noise + (rms - this.noise) * 0.01);
    const voiced = rms > Math.max(this.o.minLevel, Math.min(this.noise, 0.03) * this.o.noiseFactor);
    const prerollFrames = Math.round(this.o.prerollMs / this.o.frameMs);

    if (this.state === 'waiting') {
      this.preroll.push(f);
      if (this.preroll.length > prerollFrames + 3) this.preroll.shift();
      this.voicedRun = voiced ? this.voicedRun + 1 : 0;
      this.waitedMs += this.o.frameMs;
      if (this.voicedRun >= 3) {
        this.state = 'speaking';
        this.frames = [...this.preroll];
        this.voicedFrames = this.voicedRun;
        this.silenceRun = 0;
      } else if (this.waitedMs >= this.o.noSpeechTimeoutMs) {
        this.state = 'no-speech';
      }
      return;
    }

    // speaking
    this.frames.push(f);
    if (voiced) {
      this.voicedFrames++;
      this.silenceRun = 0;
    } else {
      this.silenceRun++;
    }
    const silentMs = this.silenceRun * this.o.frameMs;
    if (silentMs >= this.o.endSilenceMs) {
      if (this.voicedFrames * this.o.frameMs >= this.o.minSpeechMs) {
        this.frames.length -= Math.max(0, this.silenceRun - Math.round(250 / this.o.frameMs)); // keep a short tail
        this.state = 'done';
      } else {
        // it was only a click or cough: start listening again
        this.state = 'waiting';
        this.frames = [];
        this.preroll = [];
        this.voicedRun = 0;
        this.voicedFrames = 0;
      }
    } else if (this.frames.length * this.o.frameMs >= this.o.maxMs) {
      this.state = 'done';
    }
  }

  /** The recorded speech (with a little silence either side). Empty unless speech was found. */
  audio(): Float32Array {
    const n = this.frames.reduce((s, f) => s + f.length, 0);
    const out = new Float32Array(n);
    let o = 0;
    for (const f of this.frames) {
      out.set(f, o);
      o += f.length;
    }
    return out;
  }
}
