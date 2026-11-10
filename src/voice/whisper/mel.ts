// Whisper's log-mel spectrogram, written from the published description of the model's preprocessing:
// 16 kHz mono audio, padded to 30 s, 400-sample Hann window, hop 160, mel filterbank (Slaney scale),
// log10, clamp to (max - 8), then (x + 4) / 4.
export const SAMPLE_RATE = 16000;
export const N_FFT = 400;
export const HOP = 160;
export const CHUNK_SECONDS = 30;
export const N_SAMPLES = SAMPLE_RATE * CHUNK_SECONDS; // 480000
export const N_FRAMES = N_SAMPLES / HOP; // 3000
const N_BINS = N_FFT / 2 + 1; // 201

const hzToMel = (f: number): number => {
  const fSp = 200 / 3;
  const minLogHz = 1000;
  const minLogMel = minLogHz / fSp;
  const logStep = Math.log(6.4) / 27;
  return f >= minLogHz ? minLogMel + Math.log(f / minLogHz) / logStep : f / fSp;
};
const melToHz = (m: number): number => {
  const fSp = 200 / 3;
  const minLogHz = 1000;
  const minLogMel = minLogHz / fSp;
  const logStep = Math.log(6.4) / 27;
  return m >= minLogMel ? minLogHz * Math.exp(logStep * (m - minLogMel)) : fSp * m;
};

interface Filter {
  start: number;
  weights: Float64Array;
}
const filterCache = new Map<number, Filter[]>();

/** Triangular mel filters, area-normalised (Slaney), 0 to 8 kHz. */
export function melFilters(nMels: number): Filter[] {
  const cached = filterCache.get(nMels);
  if (cached) return cached;
  const fftFreqs = Array.from({ length: N_BINS }, (_, i) => (i * SAMPLE_RATE) / N_FFT);
  const melMax = hzToMel(SAMPLE_RATE / 2);
  const points = Array.from({ length: nMels + 2 }, (_, i) => melToHz((melMax * i) / (nMels + 1)));
  const filters: Filter[] = [];
  for (let m = 0; m < nMels; m++) {
    const lo = points[m]!;
    const mid = points[m + 1]!;
    const hi = points[m + 2]!;
    const enorm = 2 / (hi - lo);
    const w: number[] = fftFreqs.map((f) => Math.max(0, Math.min((f - lo) / (mid - lo), (hi - f) / (hi - mid))) * enorm);
    const first = w.findIndex((x) => x > 0);
    let last = w.length - 1;
    while (last > first && w[last] === 0) last--;
    filters.push({ start: first < 0 ? 0 : first, weights: Float64Array.from(first < 0 ? [0] : w.slice(first, last + 1)) });
  }
  filterCache.set(nMels, filters);
  return filters;
}

let cosT: Float64Array | undefined;
let sinT: Float64Array | undefined;
let hann: Float64Array | undefined;
function tables(): { cosT: Float64Array; sinT: Float64Array; hann: Float64Array } {
  if (!cosT || !sinT || !hann) {
    cosT = new Float64Array(N_BINS * N_FFT);
    sinT = new Float64Array(N_BINS * N_FFT);
    hann = new Float64Array(N_FFT);
    for (let n = 0; n < N_FFT; n++) hann[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT);
    for (let k = 0; k < N_BINS; k++) {
      for (let n = 0; n < N_FFT; n++) {
        const a = (2 * Math.PI * k * n) / N_FFT;
        cosT[k * N_FFT + n] = Math.cos(a);
        sinT[k * N_FFT + n] = Math.sin(a);
      }
    }
  }
  return { cosT, sinT, hann };
}

/**
 * Returns nMels x 3000 values (row-major: mel bin, then time) for up to 30 s of 16 kHz mono audio.
 * Frames that lie entirely in the zero padding are filled directly instead of being transformed,
 * so short commands (a few seconds) cost a few milliseconds.
 */
export function logMelSpectrogram(audio: Float32Array, nMels = 80): Float32Array {
  const { cosT, sinT, hann } = tables();
  const filters = melFilters(nMels);
  const len = Math.min(audio.length, N_SAMPLES);
  const half = N_FFT / 2;

  // centre-padded signal: index i here is sample (i - 200) of the audio, reflected at the start
  const padded = new Float64Array(N_SAMPLES + N_FFT);
  for (let i = 0; i < padded.length; i++) {
    const n = i - half;
    const src = n < 0 ? -n : n;
    padded[i] = src < len ? audio[src]! : 0;
  }

  const logSpec = new Float32Array(nMels * N_FRAMES).fill(-10); // log10(1e-10) for silent frames
  const lastActive = Math.min(N_FRAMES - 1, Math.floor((len + half - 1) / HOP));
  const power = new Float64Array(N_BINS);
  const w = new Float64Array(N_FFT);
  let maxVal = -Infinity;

  for (let t = 0; t <= lastActive; t++) {
    const base = t * HOP;
    for (let n = 0; n < N_FFT; n++) w[n] = padded[base + n]! * hann[n]!;
    for (let k = 0; k < N_BINS; k++) {
      let re = 0;
      let im = 0;
      const row = k * N_FFT;
      for (let n = 0; n < N_FFT; n++) {
        const x = w[n]!;
        re += x * cosT[row + n]!;
        im += x * sinT[row + n]!;
      }
      power[k] = re * re + im * im;
    }
    for (let m = 0; m < nMels; m++) {
      const f = filters[m]!;
      let s = 0;
      for (let j = 0; j < f.weights.length; j++) s += f.weights[j]! * power[f.start + j]!;
      const v = Math.log10(Math.max(s, 1e-10));
      logSpec[m * N_FRAMES + t] = v;
    }
  }
  for (let i = 0; i < logSpec.length; i++) if (logSpec[i]! > maxVal) maxVal = logSpec[i]!;
  const floor = maxVal - 8;
  for (let i = 0; i < logSpec.length; i++) logSpec[i] = (Math.max(logSpec[i]!, floor) + 4) / 4;
  return logSpec;
}
