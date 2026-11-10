// Speech in/out. Two speech-to-text engines share one interface:
//  - browserStt:  the browser's built-in recognition. Good accuracy, but Chrome/Edge send the audio to the
//                 browser maker's servers, so it needs internet.
//  - offlineStt:  Whisper running on this device (see offlineStt.ts). Works with no internet at all.
export type SttState = 'loading' | 'listening' | 'transcribing';

export interface SttHandlers {
  onText(text: string, final: boolean): void;
  /** Always called once at the end. `error` is a short code ('no-speech', 'unclear', 'network', ...) or a message. */
  onEnd(error?: string): void;
  onState?(state: SttState): void;
  /** Microphone loudness 0..1, for a level meter. */
  onLevel?(level: number): void;
}

export interface SttEngine {
  readonly id: 'browser' | 'offline';
  readonly name: string;
  readonly needsInternet: boolean;
  isSupported(): boolean;
  /** Starts listening; returns a function that stops it. `hint` lists words likely to be spoken (offline engine only). */
  start(lang: string, h: SttHandlers, hint?: string): () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SR = (): any => (typeof window === 'undefined' ? undefined : (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition);

export const browserStt: SttEngine = {
  id: 'browser',
  name: 'Browser speech recognition (needs internet)',
  needsInternet: true,
  isSupported: () => !!SR(),
  start(lang, h) {
    const Ctor = SR();
    if (!Ctor) {
      h.onEnd('Speech recognition is not supported in this browser');
      return () => undefined;
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      const r = e.results[e.results.length - 1];
      h.onText(r[0].transcript as string, !!r.isFinal);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => h.onEnd(e.error as string);
    rec.onend = () => h.onEnd();
    rec.onstart = () => h.onState?.('listening');
    try {
      rec.start();
    } catch (err) {
      h.onEnd(String(err));
    }
    return () => {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    };
  },
};

export function speak(text: string, lang: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 1;
  window.speechSynthesis.speak(u);
}
