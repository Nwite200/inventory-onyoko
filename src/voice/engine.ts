// Chooses which speech engine to use right now.
import { config } from '../config';
import { browserStt, type SttEngine } from './speech';
import { INSECURE_MESSAGE, isSecure } from '../secure';
import { offlineSpeech, offlineStt } from './offlineStt';

export type EngineChoice = 'auto' | 'browser' | 'offline';

export type Pick = { engine: SttEngine } | { error: string };

const online = (): boolean => typeof navigator === 'undefined' || navigator.onLine;

export const SETUP_HINT = 'Open Settings > Voice and tap "Download offline voice" while you have internet. You only need to do it once per device.';

/**
 * auto    : the browser's recognition when online (it is very accurate), the on-device model when offline.
 * browser : always the browser's (needs internet).
 * offline : always the on-device model.
 */
export async function pickEngine(choice: EngineChoice = config.speechEngine): Promise<Pick> {
  // no engine can reach the microphone on an insecure page, so say so instead of failing silently
  if (!isSecure()) return { error: INSECURE_MESSAGE };
  const offlineReady = offlineStt.isSupported() && (await offlineSpeech.installed());

  if (choice === 'offline') {
    if (!offlineStt.isSupported()) return { error: 'On-device voice is not supported in this browser. Try a recent Chrome, Edge, Firefox or Safari.' };
    return offlineReady ? { engine: offlineStt } : { error: `Offline voice is not set up on this device. ${SETUP_HINT}` };
  }
  if (choice === 'browser') {
    if (!browserStt.isSupported()) return { error: 'This browser has no built-in speech recognition. Use Chrome or Edge, or switch to offline voice in Settings.' };
    return online() ? { engine: browserStt } : { error: 'You are offline and the browser needs internet for voice. Type the command instead, or use offline voice in Settings.' };
  }

  // auto
  if (online() && browserStt.isSupported()) return { engine: browserStt };
  if (offlineReady) return { engine: offlineStt };
  if (!online()) return { error: `You are offline and offline voice is not set up on this device. Type the command for now. ${SETUP_HINT}` };
  return { error: `This browser has no built-in speech recognition. ${SETUP_HINT}` };
}

/** True when it is worth retrying with the on-device model after the browser engine failed. */
export async function canFallBackToOffline(): Promise<boolean> {
  return offlineStt.isSupported() && (await offlineSpeech.installed());
}
