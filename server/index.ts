// Run with: node server/index.ts   (Node 22.18+)
import { existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.ts';
import { hashPassword } from './auth.ts';
import { createServer as createHttps } from 'node:https';
import { createApp, listen } from './app.ts';
import { listenSetup, loadTls } from './tls.ts';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8787);
const dbPath = resolve(process.env.DB_PATH ?? resolve(here, '../data/openpos.db'));
mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);

// signing secret: from env, or generated once and kept in the database
let secret = process.env.AUTH_SECRET;
if (!secret) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'secret'").get() as { value: string } | undefined;
  secret = row?.value ?? randomBytes(32).toString('hex');
  if (!row) db.prepare("INSERT INTO meta (key, value) VALUES ('secret', ?)").run(secret);
}

// optional: create the first admin from environment variables (handy for Docker)
const { ADMIN_USER, ADMIN_PASSWORD } = process.env;
const users = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
if (users === 0 && ADMIN_USER && ADMIN_PASSWORD) {
  if (ADMIN_PASSWORD.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters');
  const { salt, hash } = hashPassword(ADMIN_PASSWORD);
  db.prepare("INSERT OR IGNORE INTO businesses (id, name, created_at) VALUES ('main', ?, ?)").run(process.env.BUSINESS_NAME ?? 'My business', Date.now());
  db.prepare("INSERT INTO users (username, role, salt, hash, created_at, business_id, is_super) VALUES (?, 'admin', ?, ?, ?, 'main', 1)").run(ADMIN_USER.toLowerCase(), salt, hash, Date.now());
  console.log(`Created admin "${ADMIN_USER}"`);
}

const staticDir = resolve(here, '../dist');
const options = { db, secret, corsOrigin: process.env.CORS_ORIGIN, staticDir: existsSync(staticDir) ? staticDir : undefined };
const tls = loadTls(dirname(dbPath));

if (tls) {
  // https: needed for the microphone, offline voice and installing the app on other devices
  createHttps({ cert: tls.cert, key: tls.key }, createApp(options)).listen(port);
  const setupPort = Number(process.env.HTTP_PORT ?? port + 1);
  listenSetup({ httpsPort: port, caPath: tls.caPath }, setupPort);
  console.log(`OpenPOS server on https://localhost:${port}  (database: ${dbPath})`);
  console.log(`Device setup page (certificate download) on http://<this-computer>:${setupPort}`);
} else {
  listen(options, port);
  console.log(`OpenPOS server on http://localhost:${port}  (database: ${dbPath})`);
  console.log('Note: this is plain http. Other devices on your network cannot use voice, offline voice or app install until you turn on https:');
  console.log('      run "node scripts/make-cert.mjs" once, then restart the server.');
}
if (!existsSync(staticDir)) console.log('Tip: run "npm run build" first so this server can also serve the app.');
