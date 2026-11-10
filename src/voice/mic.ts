import { Resampler } from './whisper/audio';

/** Friendly text for the ways a microphone can fail. */
export function micErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access was blocked. Allow the microphone for this site in the browser, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found on this device.';
  if (name === 'NotReadableError') return 'The microphone is being used by another app.';
  if (!window.isSecureContext) return 'The microphone only works on a secure (https) page, or on localhost.';
  return `Microphone problem: ${(e as Error)?.message ?? 'unknown error'}`;
}

/**
 * Opens the microphone and delivers 16 kHz mono audio chunks. Returns a function that stops it.
 * (ScriptProcessor is old but works in every browser, including iPhones, with no extra files.)
 */
export async function captureMic(onChunk: (audio16k: Float32Array) => void): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no mediaDevices'), { name: 'SecurityError' });
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const resampler = new Resampler(ctx.sampleRate);
  proc.onaudioprocess = (ev) => onChunk(resampler.process(new Float32Array(ev.inputBuffer.getChannelData(0))));
  source.connect(proc);
  proc.connect(ctx.destination); // required for the callback to run; we never write output, so it stays silent
  return () => {
    proc.onaudioprocess = null;
    try {
      source.disconnect();
      proc.disconnect();
    } catch {
      /* already disconnected */
    }
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
}
