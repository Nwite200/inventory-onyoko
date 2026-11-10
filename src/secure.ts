// Browsers switch off the microphone, Cache Storage (offline voice model) and service workers (offline app,
// "install app") on any page that is not https, except on localhost. These helpers explain that clearly.

export function isSecure(): boolean {
  return typeof window === 'undefined' || window.isSecureContext;
}

export const INSECURE_MESSAGE =
  'This page is on a plain http address, so the browser has switched off the microphone, offline voice and offline app mode. ' +
  'Ask whoever set up the server to turn on https (run "node scripts/make-cert.mjs" on the server, then open the https address on this device).';
