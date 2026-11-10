// Keeps this device and the server in step: push local changes, then pull other devices' changes.
// Works in the background; the app never waits for it, so selling continues offline.
import { db } from './db';
import { api, ApiError, getSession, logout, serverBase, serverMode } from './auth';
import { getDeviceId } from './numbering';
import { applyChanges, undoRefused, type RemoteChange } from './syncApply';

export const SYNC_EVENT = 'openpos-sync';

export interface SyncResult {
  pushed: number;
  pulled: number;
  rejected: number;
  note?: string;
}

export const syncStatus = { at: 0, error: '' };

export { getDeviceId };

const cursorKey = (): string => `openpos.cursor.${serverBase()}`;
const getCursor = (): number => Number(localStorage.getItem(cursorKey()) ?? 0) || 0;
const setCursor = (n: number): void => localStorage.setItem(cursorKey(), String(n));

async function doSync(): Promise<SyncResult> {
  const r: SyncResult = { pushed: 0, pulled: 0, rejected: 0 };
  if (!serverMode()) return { ...r, note: 'No server configured' };
  const session = getSession();
  if (!session) return { ...r, note: 'Sign in to sync' };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { ...r, note: 'Offline' };
  const deviceId = getDeviceId();

  // Cashiers are sent a reduced feed (no prices, suppliers or purchases). If a different kind of user now
  // signs in on this device, start the pull over so nothing hidden from the previous user is missed.
  // (Applying a change twice is harmless, so starting over is safe.)
  const feed = session.role === 'cashier' ? 'cashier' : 'full';
  const feedKey = `openpos.feed.${serverBase()}`;
  if (localStorage.getItem(feedKey) !== feed) {
    if (localStorage.getItem(feedKey) !== null) setCursor(0);
    localStorage.setItem(feedKey, feed);
  }

  // 1. push
  for (;;) {
    const batch = await db.outbox.orderBy('id').limit(200).toArray();
    if (batch.length === 0) break;
    const reply = await api<{ accepted: number[]; rejected: { id: number; reason: string }[] }>(
      'POST',
      '/api/sync',
      { deviceId, items: batch },
      session.token,
    );
    // rejected changes are dropped (retrying cannot help) but recorded so they are not lost silently
    for (const rej of reply.rejected) {
      const item = batch.find((b) => b.id === rej.id);
      await db.audit.add({
        at: Date.now(), source: 'ui', intent: 'sync_rejected', role: session.role,
        result: `${item?.entity}:${item?.op} refused by server: ${rej.reason}`,
      });
      if (item) await undoRefused(item.entity, item.op, item.payload as Record<string, any>); // keep this device's numbers honest
    }
    await db.outbox.bulkDelete([...reply.accepted, ...reply.rejected.map((x) => x.id)]);
    r.pushed += reply.accepted.length;
    r.rejected += reply.rejected.length;
    if (batch.length < 200) break;
  }

  // 2. pull
  for (;;) {
    const page = await api<{ changes: RemoteChange[]; cursor: number; hasMore: boolean }>(
      'GET',
      `/api/sync?since=${getCursor()}&deviceId=${encodeURIComponent(deviceId)}`,
      undefined,
      session.token,
    );
    await applyChanges(page.changes);
    setCursor(page.cursor);
    r.pulled += page.changes.length;
    if (!page.hasMore) break;
  }
  return r;
}

let running: Promise<SyncResult> | null = null;
let failures = 0;
let nextAllowed = 0;

function publish(error = ''): void {
  syncStatus.error = error;
  if (!error) syncStatus.at = Date.now();
  window.dispatchEvent(new Event(SYNC_EVENT));
}

export function syncNow(): Promise<SyncResult> {
  if (running) return running;
  running = doSync()
    .then((r) => {
      failures = 0;
      if (!r.note) publish();
      return r;
    })
    .catch((e: unknown) => {
      failures++;
      nextAllowed = Date.now() + Math.min(5 * 60_000, 15_000 * 2 ** failures); // back off: 30s, 60s, ... max 5 min
      if (e instanceof ApiError && e.status === 401) logout(); // session expired or account disabled
      publish(e instanceof Error ? e.message : 'Sync failed');
      throw e;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

export function startSync(): void {
  const tick = (force = false) => {
    if (!serverMode() || !getSession()) return;
    if (!force && Date.now() < nextAllowed) return;
    void syncNow().catch(() => undefined);
  };
  window.addEventListener('online', () => tick(true));
  window.addEventListener('openpos-auth', () => tick(true)); // just signed in
  setInterval(() => tick(), 30_000);
  tick(true);

  // push soon after something is queued (e.g. right after a sale) instead of waiting for the timer
  let timer: ReturnType<typeof setTimeout> | undefined;
  db.outbox.hook('creating', () => {
    clearTimeout(timer);
    timer = setTimeout(() => tick(), 1500);
  });
}
