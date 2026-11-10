import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { listenSetup, loadTls } from './tls.ts';

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'tls-')); dirs.push(d); return d; };

describe('loadTls', () => {
  it('returns nothing when there are no certificate files', () => {
    expect(loadTls(tmp(), {})).toBeUndefined();
  });
  it('finds <data dir>/tls and the CA file', () => {
    const d = tmp(); mkdirSync(join(d, 'tls'));
    for (const f of ['server.crt', 'server.key', 'ca.crt']) writeFileSync(join(d, 'tls', f), f);
    const t = loadTls(d, {})!;
    expect(t.cert.toString()).toBe('server.crt');
    expect(t.caPath).toBe(join(d, 'tls', 'ca.crt'));
  });
  it('honours TLS_DIR and works without a CA', () => {
    const d = tmp(); writeFileSync(join(d, 'server.crt'), 'c'); writeFileSync(join(d, 'server.key'), 'k');
    const t = loadTls('/nowhere', { TLS_DIR: d })!;
    expect(t.caPath).toBeUndefined();
  });
});

describe('setup page', () => {
  it('serves instructions and the CA, and redirects everything else to https', async () => {
    const d = tmp(); writeFileSync(join(d, 'ca.crt'), 'CERTDATA');
    const s = listenSetup({ httpsPort: 8787, caPath: join(d, 'ca.crt') }, 0); servers.push(s);
    await new Promise((r) => s.once('listening', r));
    const base = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
    const home = await fetch(base + '/');
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('https://127.0.0.1:8787/');
    const ca = await fetch(base + '/ca.crt');
    expect(ca.headers.get('content-type')).toBe('application/x-x509-ca-cert');
    expect(await ca.text()).toBe('CERTDATA');
    const r = await fetch(base + '/products?x=1', { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://127.0.0.1:8787/products?x=1');
  });
  it('says so when no certificate authority exists', async () => {
    const s = listenSetup({ httpsPort: 8787 }, 0); servers.push(s);
    await new Promise((r) => s.once('listening', r));
    const t = await (await fetch(`http://127.0.0.1:${(s.address() as { port: number }).port}/`)).text();
    expect(t).toContain('make-cert');
  });
});
