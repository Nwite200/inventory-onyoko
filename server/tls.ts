// Optional https for the shop server, plus a tiny plain-http "install the certificate" page.
import { createServer as createHttpServer, type RequestListener } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TlsFiles {
  cert: Buffer;
  key: Buffer;
  caPath?: string;
}

/** Finds the certificate: TLS_CERT/TLS_KEY, or the files made by scripts/make-cert.mjs in <data dir>/tls. */
export function loadTls(dataDir: string, env: NodeJS.ProcessEnv = process.env): TlsFiles | undefined {
  const dir = env.TLS_DIR ?? join(dataDir, 'tls');
  const certPath = env.TLS_CERT ?? join(dir, 'server.crt');
  const keyPath = env.TLS_KEY ?? join(dir, 'server.key');
  if (!existsSync(certPath) || !existsSync(keyPath)) return undefined;
  const ca = join(dir, 'ca.crt');
  return { cert: readFileSync(certPath), key: readFileSync(keyPath), caPath: existsSync(ca) ? ca : undefined };
}

const page = (httpsUrl: string, hasCa: boolean): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Set up this device</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:0 auto;padding:16px;color:#16201f}
a.btn{display:inline-block;background:#0f766e;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;margin:8px 0}
details{border:1px solid #dbe3e2;border-radius:8px;padding:8px 12px;margin:8px 0}summary{cursor:pointer;font-weight:600}</style></head>
<body><h1>Set up this device</h1>
<p>To use voice, offline mode and the app install, browsers need a secure (https) connection. Do these two steps once on this device.</p>
${
  hasCa
    ? `<h2>1. Install the shop certificate</h2><p><a class="btn" href="/ca.crt">Download certificate</a></p>
<details><summary>Android</summary><p>Open the downloaded file, or go to Settings &gt; Security &gt; Encryption &amp; credentials &gt; Install a certificate &gt; <b>CA certificate</b>, and choose the file. Accept the warning (it is your own shop's certificate).</p></details>
<details><summary>iPhone / iPad</summary><p>Tap Download and allow it. Open Settings &gt; <b>Profile Downloaded</b> &gt; Install. Then Settings &gt; General &gt; About &gt; <b>Certificate Trust Settings</b> and switch on "OpenPOS Shop CA".</p></details>
<details><summary>Windows</summary><p>Double-click the file &gt; Install Certificate &gt; Local Machine &gt; "Place all certificates in the following store" &gt; <b>Trusted Root Certification Authorities</b>.</p></details>
<details><summary>Mac</summary><p>Double-click the file to add it to Keychain Access, open it, expand Trust, and set "When using this certificate" to <b>Always Trust</b>.</p></details>
<details><summary>Firefox (any device)</summary><p>Firefox keeps its own list: Settings &gt; Privacy &amp; Security &gt; Certificates &gt; View Certificates &gt; Authorities &gt; Import.</p></details>`
    : `<p><b>The administrator has not created the certificate authority file.</b> Ask them to run <code>node scripts/make-cert.mjs</code> on the server.</p>`
}
<h2>2. Open the shop app</h2><p><a class="btn" href="${httpsUrl}">Open ${httpsUrl}</a></p>
<p style="color:#647270;font-size:14px">If the browser still warns about the connection, step 1 was not completed.</p>
</body></html>`;

/** Plain-http listener: the certificate download page, and a redirect to https for everything else. */
export function setupHandler(opts: { httpsPort: number; caPath?: string }): RequestListener {
  return (req, res) => {
    const host = (req.headers.host ?? 'localhost').replace(/:\d+$/, '');
    const httpsUrl = `https://${host}:${opts.httpsPort}/`;
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path === '/ca.crt' && opts.caPath) {
      const body = readFileSync(opts.caPath);
      res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="openpos-shop-ca.crt"', 'Content-Length': body.length });
      res.end(body);
    } else if (path === '/' || path === '/setup') {
      const body = page(httpsUrl, !!opts.caPath);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    } else {
      res.writeHead(302, { Location: httpsUrl.slice(0, -1) + (req.url ?? '/') });
      res.end();
    }
  };
}

export function listenSetup(opts: { httpsPort: number; caPath?: string }, port: number) {
  return createHttpServer(setupHandler(opts)).listen(port);
}
