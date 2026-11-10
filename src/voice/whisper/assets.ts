// Downloads the speech model and runtime from the app's own server ONCE and keeps them in the browser's
// Cache Storage, so afterwards they load with no internet. Used by both the page and the worker.
export const CACHE_NAME = 'openpos-speech-v1';

export interface Manifest {
  version: string;
  files: { name: string; size: number }[];
}

export interface Asset {
  url: string;
  /** Cache key; includes the version, so a newer model is fetched again and the old one is removed. */
  key: string;
  size: number;
  kind: 'ort-mjs' | 'ort-wasm' | 'encoder' | 'decoder' | 'tokens';
}

export class ModelMissingError extends Error {}

function isManifest(x: unknown): x is Manifest {
  const m = x as Manifest;
  return !!m && typeof m.version === 'string' && Array.isArray(m.files) && m.files.every((f) => typeof f.name === 'string' && typeof f.size === 'number');
}

/** Network first (so a new model is noticed), cached copy when offline. */
async function manifest(url: string): Promise<Manifest> {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) {
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text); // a server without the files answers with its home page instead
      } catch {
        json = undefined;
      }
      if (isManifest(json)) {
        await cache.put(url, new Response(text, { headers: { 'content-type': 'application/json' } }));
        return json;
      }
    }
    if (res.status === 404 || res.ok) throw new ModelMissingError('missing');
  } catch (e) {
    if (!(e instanceof ModelMissingError)) {
      const hit = await cache.match(url); // offline
      if (hit) {
        const json: unknown = await hit.json();
        if (isManifest(json)) return json;
      }
    }
  }
  throw new ModelMissingError(
    'The offline voice model is not on this server yet. The administrator needs to run "npm run get-model" once and rebuild.',
  );
}

export async function planAssets(modelBase: string, ortBase: string): Promise<Asset[]> {
  const [model, ort] = await Promise.all([manifest(modelBase + 'manifest.json'), manifest(ortBase + 'manifest.json')]);
  const size = (m: Manifest, n: string): number => m.files.find((f) => f.name === n)?.size ?? 0;
  const mk = (base: string, m: Manifest, name: string, kind: Asset['kind']): Asset => ({
    url: base + name,
    key: `${base}${name}?v=${m.version}`,
    size: size(m, name),
    kind,
  });
  return [
    mk(ortBase, ort, 'ort-wasm-simd-threaded.mjs', 'ort-mjs'),
    mk(ortBase, ort, 'ort-wasm-simd-threaded.wasm', 'ort-wasm'),
    mk(modelBase, model, 'encoder.onnx', 'encoder'),
    mk(modelBase, model, 'decoder.onnx', 'decoder'),
    mk(modelBase, model, 'tokens.txt', 'tokens'),
  ];
}

/** True when every file is already stored on this device (so voice works without internet). */
export async function isInstalled(modelBase: string, ortBase: string): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const assets = await planAssets(modelBase, ortBase);
    for (const a of assets) if (!(await cache.match(a.key))) return false;
    return true;
  } catch {
    return false;
  }
}

export async function fetchAsset(a: Asset, onBytes: (n: number) => void): Promise<Uint8Array> {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(a.key);
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer());
    onBytes(bytes.length);
    return bytes;
  }
  const res = await fetch(a.url);
  if (!res.ok || !res.body) throw new Error(`Could not download ${a.url} (server replied ${res.status})`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    onBytes(value.length);
  }
  if (a.size && total !== a.size) throw new Error(`${a.url} was incomplete (${total} of ${a.size} bytes). Please try again.`);
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    bytes.set(c, o);
    o += c.length;
  }
  await cache.put(a.key, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
  return bytes;
}

/** Removes files from older model versions. */
export async function pruneCache(keep: string[]): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  for (const req of await cache.keys()) {
    const u = new URL(req.url);
    const k = u.pathname + u.search;
    if (u.search && !keep.includes(k)) await cache.delete(req);
  }
}

export async function removeInstalled(): Promise<void> {
  await caches.delete(CACHE_NAME);
}
