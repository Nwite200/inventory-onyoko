import { describe, expect, it } from 'vitest';
import { N_FRAMES, logMelSpectrogram, melFilters } from './mel';

const SR = 16000;
describe('log-mel spectrogram', () => {
  it('has Whisper\'s exact shape: 80 x 3000', () => {
    const m = logMelSpectrogram(new Float32Array(SR));
    expect(m.length).toBe(80 * N_FRAMES);
  });
  it('silence is one constant value', () => {
    const m = logMelSpectrogram(new Float32Array(SR));
    expect(new Set(m).size).toBe(1);
    expect(m[0]).toBeCloseTo(-1.5, 5); // (log10(1e-10) + 4) / 4
  });
  it('a 1 kHz tone lights up the mel bin around 1 kHz, only while it plays', () => {
    const tone = Float32Array.from({ length: SR }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SR));
    const m = logMelSpectrogram(tone);
    const frame = 50; // 0.5 s in
    let best = 0;
    for (let b = 0; b < 80; b++) if (m[b * N_FRAMES + frame]! > m[best * N_FRAMES + frame]!) best = b;
    expect(best).toBeGreaterThanOrEqual(25);
    expect(best).toBeLessThanOrEqual(29);
    expect(m[best * N_FRAMES + 50]!).toBeGreaterThan(m[best * N_FRAMES + 2000]!); // later frames are silence
  });
  it('values stay within the range the model was trained on', () => {
    const noise = Float32Array.from({ length: SR * 3 }, () => Math.random() - 0.5);
    const m = logMelSpectrogram(noise);
    let max = -Infinity;
    let min = Infinity;
    for (const v of m) {
      if (v > max) max = v;
      if (v < min) min = v;
    }
    expect(max - min).toBeLessThanOrEqual(2.0001); // clamp is 8 in log10 units, divided by 4
  });
  it('audio longer than 30 s is cut, not an error', () => {
    expect(logMelSpectrogram(new Float32Array(SR * 31)).length).toBe(80 * N_FRAMES);
  });
  it('filters are 80 triangles that each cover some frequencies', () => {
    const f = melFilters(80);
    expect(f).toHaveLength(80);
    for (const x of f) expect(x.weights.some((w) => w > 0)).toBe(true);
  });
});
