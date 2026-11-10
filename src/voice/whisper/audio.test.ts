import { describe, expect, it } from 'vitest';
import { Endpointer, Resampler } from './audio';

const SR = 16000;
const tone = (ms: number, amp = 0.2, freq = 220): Float32Array =>
  Float32Array.from({ length: (SR * ms) / 1000 }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR) * (0.6 + 0.4 * Math.sin(i / 400)));
const quiet = (ms: number, amp = 0.002): Float32Array => Float32Array.from({ length: (SR * ms) / 1000 }, () => (Math.random() - 0.5) * 2 * amp);
const cat = (...parts: Float32Array[]): Float32Array => {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
/** feeds audio in awkward chunk sizes, like a real microphone */
function run(ep: Endpointer, audio: Float32Array, chunk = 1000) {
  for (let i = 0; i < audio.length; i += chunk) if (ep.push(audio.slice(i, i + chunk)) !== 'waiting' && ep.state !== 'speaking') break;
  return ep.state;
}

describe('Resampler', () => {
  it('48 kHz to 16 kHz keeps duration and a low tone', () => {
    const r = new Resampler(48000);
    const input = Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 200 * i) / 48000));
    const out: number[] = [];
    for (let i = 0; i < input.length; i += 4096) out.push(...r.process(input.slice(i, i + 4096)));
    expect(Math.abs(out.length - 16000)).toBeLessThanOrEqual(3);
    const peak = Math.max(...out.slice(100, 15000).map(Math.abs));
    expect(peak).toBeGreaterThan(0.95);
    expect(peak).toBeLessThan(1.02);
  });
  it('44.1 kHz works and chunking does not change the result', () => {
    const input = Float32Array.from({ length: 44100 }, (_, i) => Math.sin((2 * Math.PI * 300 * i) / 44100));
    const whole = new Resampler(44100).process(input);
    const r = new Resampler(44100);
    const parts: number[] = [];
    for (let i = 0; i < input.length; i += 1000) parts.push(...r.process(input.slice(i, i + 1000)));
    expect(Math.abs(whole.length - parts.length)).toBeLessThanOrEqual(1);
    for (let i = 0; i < 1000; i++) expect(parts[i]).toBeCloseTo(whole[i]!, 5);
  });
  it('16 kHz passes through untouched', () => {
    const a = tone(100);
    expect(new Resampler(16000).process(a)).toBe(a);
  });
});

describe('Endpointer', () => {
  it('finds speech between silences and stops after the pause', () => {
    const ep = new Endpointer();
    const state = run(ep, cat(quiet(600), tone(1500), quiet(1800)));
    expect(state).toBe('done');
    const ms = (ep.audio().length / SR) * 1000;
    expect(ms).toBeGreaterThan(1500); // all of the speech
    expect(ms).toBeLessThan(1500 + 300 + 400); // plus only a little silence either side
  });
  it('does not cut off a short pause between words', () => {
    const ep = new Endpointer();
    const state = run(ep, cat(quiet(300), tone(800), quiet(500), tone(800), quiet(1800)));
    expect(state).toBe('done');
    expect(ep.audio().length / SR).toBeGreaterThan(2.0);
  });
  it('gives up when nobody speaks', () => {
    const ep = new Endpointer();
    expect(run(ep, quiet(9000))).toBe('no-speech');
    expect(ep.audio().length).toBe(0);
  });
  it('ignores a click or cough and keeps listening', () => {
    const ep = new Endpointer();
    run(ep, cat(quiet(500), tone(80, 0.3), quiet(1500)));
    expect(ep.state).toBe('waiting');
    expect(run(ep, cat(tone(1000), quiet(1500)))).toBe('done');
  });
  it('adapts to a noisy room instead of treating noise as speech', () => {
    const ep = new Endpointer();
    expect(run(ep, quiet(9000, 0.02))).toBe('no-speech');
  });
  it('still hears speech in a noisy room', () => {
    const ep = new Endpointer();
    const noise = (ms: number) => quiet(ms, 0.01);
    const under = noise(1200);
    const speech = tone(1200, 0.25).map((x, i) => x + under[i]!);
    expect(run(ep, cat(noise(800), speech, noise(1800)))).toBe('done');
  });
  it('stops at the maximum length', () => {
    const ep = new Endpointer({ maxMs: 3000 });
    expect(run(ep, tone(6000))).toBe('done');
    expect(ep.audio().length / SR).toBeLessThanOrEqual(3.1);
  });
});
