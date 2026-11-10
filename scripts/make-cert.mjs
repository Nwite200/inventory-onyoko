// Creates a certificate so the shop server can use https on your local network.
// Browsers only allow the microphone, offline voice and "install app" on https pages.
//
//   node scripts/make-cert.mjs                     -> detects this computer's network addresses
//   node scripts/make-cert.mjs 192.168.1.10 shop.local   -> use these addresses/names
//
// It makes a small private "certificate authority" (ca.crt) plus a server certificate signed by it.
// Install ca.crt ONCE on each phone/PC (the server shows a page with steps); after that the browser trusts the shop server.
// Run it again later (for example if the server's address changes): the authority is reused, so devices stay trusted.
// Needs the "openssl" command (Linux/macOS have it; on Windows install Git for Windows or OpenSSL).
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { hostname, networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.env.TLS_DIR ?? join(root, 'data', 'tls'));
mkdirSync(outDir, { recursive: true });

const isIp = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || s.includes(':');
let names = process.argv.slice(2);
if (names.length === 0) {
  for (const list of Object.values(networkInterfaces()))
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) names.push(i.address);
  names.push(hostname());
}
names = [...new Set(['localhost', '127.0.0.1', ...names])];
const san = names.map((n) => (isIp(n) ? `IP:${n}` : `DNS:${n}`)).join(',');

const run = (args) => {
  const r = spawnSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (r.error) {
    console.error('Could not run "openssl". Install it first (Windows: Git for Windows includes it).');
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`openssl failed: ${r.stderr}`);
    process.exit(1);
  }
};
const p = (f) => join(outDir, f);

if (!existsSync(p('ca.crt')) || !existsSync(p('ca.key'))) {
  console.log('Creating the shop certificate authority (valid 10 years)...');
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', p('ca.key'), '-out', p('ca.crt'), '-days', '3650',
    '-subj', '/CN=OpenPOS Shop CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
} else {
  console.log('Reusing the existing certificate authority (devices that already trust it keep working).');
}

console.log(`Creating the server certificate for: ${names.join(', ')}`);
run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', p('server.key'), '-out', p('server.csr'), '-subj', '/CN=OpenPOS Server']);
writeFileSync(p('server.ext'), `basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`);
// 825 days is the longest iPhones accept
run(['x509', '-req', '-in', p('server.csr'), '-CA', p('ca.crt'), '-CAkey', p('ca.key'), '-CAcreateserial', '-out', p('server.crt'), '-days', '825', '-extfile', p('server.ext')]);
for (const f of ['server.csr', 'server.ext', 'ca.srl']) rmSync(p(f), { force: true });

console.log(`
Done. Files are in ${outDir}
  server.crt + server.key  -> used by the server automatically next time it starts
  ca.crt                   -> install this on each phone/PC (see below)

Next:
  1. Restart the server:  npm run server
  2. On each device open  http://${names.find((n) => isIp(n) && !n.startsWith('127.')) ?? 'SERVER-ADDRESS'}:8788  and follow the steps to install the certificate.
  3. Then use  https://${names.find((n) => isIp(n) && !n.startsWith('127.')) ?? 'SERVER-ADDRESS'}:8787
Keep ca.key private: anyone with it could make certificates your devices would trust.
`);
