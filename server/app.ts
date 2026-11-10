import { createServer as createHttpServer, type IncomingMessage, type RequestListener, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { ROLES, canPush, hashPassword, signToken, verifyPassword, verifyToken, type Role } from './auth.ts';

const TOKEN_TTL_MS = 14 * 24 * 3600 * 1000;
const MAX_BODY = 2 * 1024 * 1024;
const PULL_LIMIT = 500;
const CASHIER_VOID_WINDOW_MS = 5 * 60 * 1000;
const ENTITIES = new Set(['product', 'stock_movement', 'sale', 'customer', 'location', 'supplier', 'purchase', 'transfer']);

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface AppOptions {
  db: DatabaseSync;
  secret: string;
  corsOrigin?: string;
  staticDir?: string;
  now?: () => number;
}

interface AuthUser {
  username: string;
  role: Role;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
};

export function createApp(opts: AppOptions): RequestListener {
  const { db, secret } = opts;
  const now = opts.now ?? Date.now;
  const failures = new Map<string, { count: number; until: number }>();

  const send = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const readJson = (req: IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolveBody, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new HttpError(413, 'Request too large'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          const v: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
          if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
          resolveBody(v as Record<string, unknown>);
        } catch {
          reject(new HttpError(400, 'Body must be a JSON object'));
        }
      });
      req.on('error', reject);
    });

  const userCount = (): number => (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;

  const authenticate = (req: IncomingMessage): AuthUser => {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    const t = token ? verifyToken(secret, token, now()) : null;
    if (!t) throw new HttpError(401, 'Please sign in');
    const row = db.prepare('SELECT username, role, disabled, token_version FROM users WHERE username = ?').get(t.username) as
      | { username: string; role: Role; disabled: number; token_version: number }
      | undefined;
    if (!row || row.disabled) throw new HttpError(401, 'Account is disabled or does not exist');
    if (row.token_version !== t.version) throw new HttpError(401, 'Your password was changed. Please sign in again.');
    return { username: row.username, role: row.role }; // role always comes from the DB, never from the token
  };

  const validUsername = (u: unknown): string => {
    if (typeof u !== 'string' || !/^[a-zA-Z0-9._-]{3,32}$/.test(u)) throw new HttpError(400, 'Username must be 3-32 letters, numbers, dot, dash or underscore');
    return u.toLowerCase();
  };
  const validPassword = (p: unknown): string => {
    if (typeof p !== 'string' || p.length < 8 || p.length > 200) throw new HttpError(400, 'Password must be at least 8 characters');
    return p;
  };

  const createUser = (username: string, password: string, role: Role): void => {
    const { salt, hash } = hashPassword(password);
    db.prepare('INSERT INTO users (username, role, salt, hash, created_at) VALUES (?, ?, ?, ?, ?)').run(username, role, salt, hash, now());
  };

  const sessionFor = (u: AuthUser) => {
    const v = (db.prepare('SELECT token_version FROM users WHERE username = ?').get(u.username) as { token_version: number }).token_version;
    return { token: signToken(secret, u.username, TOKEN_TTL_MS, now(), v), user: u };
  };

  /** Sets a new password and bumps token_version, so every session signed in before this moment stops working. */
  const setPassword = (username: string, password: string): void => {
    const { salt, hash } = hashPassword(password);
    db.prepare('UPDATE users SET salt = ?, hash = ?, token_version = token_version + 1 WHERE username = ?').run(salt, hash, username);
  };

  // ---- sync -----------------------------------------------------------------------------

  const checkPayload = (entity: string, op: string, p: unknown): string | null => {
    if (!p || typeof p !== 'object') return 'payload must be an object';
    const o = p as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id || o.id.length > 64) return 'payload.id is required';
    if (entity === 'sale' && op === 'create') {
      if (!Array.isArray(o.items) || o.items.length === 0 || o.items.length > 200) return 'sale needs 1-200 items';
      for (const it of o.items as Record<string, unknown>[]) {
        if (!it || typeof it.productId !== 'string' || !(Number(it.qty) > 0) || !(Number(it.price) >= 0)) return 'bad sale item';
      }
    }
    if (entity === 'stock_movement' && op === 'create') {
      if (typeof o.productId !== 'string' || !Number.isFinite(o.delta) || o.delta === 0) return 'bad stock movement';
    }
    if (entity === 'location' && op === 'create') {
      if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > 80) return 'shop needs a name';
    }
    if (entity === 'supplier' && op === 'create') {
      if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > 120) return 'supplier needs a name';
    }
    const goodItems = (needCost: boolean): boolean =>
      Array.isArray(o.items) && o.items.length > 0 && o.items.length <= 200 &&
      (o.items as Record<string, unknown>[]).every((it) => it && typeof it.productId === 'string' && Number(it.qty) > 0 && (!needCost || Number(it.cost) >= 0));
    if (entity === 'purchase') {
      if (op === 'create' && (!goodItems(true) || typeof o.locationId !== 'string' || !(Number(o.total) >= 0) || !(Number(o.paid) >= 0))) return 'bad purchase';
      if (op === 'void' && (!goodItems(false) || typeof o.locationId !== 'string')) return 'bad purchase void';
      if (op === 'pay' && (typeof o.paymentId !== 'string' || !(Number(o.amount) > 0))) return 'bad purchase payment';
    }
    if (entity === 'transfer') {
      if (op === 'create' && (!goodItems(false) || typeof o.fromLocationId !== 'string' || typeof o.toLocationId !== 'string' || o.fromLocationId === o.toLocationId)) return 'bad transfer';
    }
    return null;
  };

  /** Cashiers keep the shelves right but never see what the shop pays. Returns null = send nothing. */
  const forCashier = (entity: string, op: string, payload: Record<string, unknown>): Record<string, unknown> | null => {
    if (entity === 'supplier') return null;
    if (entity === 'purchase') {
      if (op === 'pay') return null;
      const items = ((payload.items ?? []) as { productId: string; qty: number }[]).map((i) => ({ productId: i.productId, qty: i.qty }));
      return { id: payload.id, locationId: payload.locationId, items }; // no number, supplier, cost or total
    }
    if (entity === 'product') {
      const { cost: _cost, costAt: _costAt, ...rest } = payload;
      return rest;
    }
    return payload;
  };

  const push = (user: AuthUser, body: Record<string, unknown>) => {
    const deviceId = body.deviceId;
    const items = body.items;
    if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 64) throw new HttpError(400, 'deviceId is required');
    if (!Array.isArray(items) || items.length > 200) throw new HttpError(400, 'items must be an array of at most 200');

    const insert = db.prepare(
      'INSERT OR IGNORE INTO changes (device_id, client_id, entity, op, payload, at, user, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const saleOwner = db.prepare(
      "SELECT user, at FROM changes WHERE entity = 'sale' AND op = 'create' AND json_extract(payload, '$.id') = ? LIMIT 1",
    );
    const sentTransfer = db.prepare(
      "SELECT payload FROM changes WHERE entity = 'transfer' AND op = 'create' AND json_extract(payload, '$.id') = ? LIMIT 1",
    );
    const accepted: number[] = [];
    const rejected: { id: number; reason: string }[] = [];

    db.exec('BEGIN');
    try {
      for (const raw of items as Record<string, unknown>[]) {
        const id = Number(raw?.id);
        const entity = String(raw?.entity);
        const op = String(raw?.op);
        const at = Number(raw?.at);
        if (!Number.isInteger(id) || !ENTITIES.has(entity) || !op || !Number.isFinite(at)) {
          if (Number.isInteger(id)) rejected.push({ id, reason: 'malformed change' });
          continue;
        }
        const problem = checkPayload(entity, op, raw.payload);
        if (problem) {
          rejected.push({ id, reason: problem });
          continue;
        }
        let payload = raw.payload as Record<string, unknown>;
        if (entity === 'transfer' && op === 'receive') {
          // stock arrives exactly as it was sent, whatever the device claims
          const sent = sentTransfer.get(String(payload.id)) as { payload: string } | undefined;
          if (!sent) {
            rejected.push({ id, reason: 'no such transfer was sent' });
            continue;
          }
          const t = JSON.parse(sent.payload) as { id: string; toLocationId: string; items: unknown[] };
          payload = { id: t.id, toLocationId: t.toLocationId, items: t.items };
        }
        let verdict = canPush(user.role, entity, op);
        if (verdict === 'check-void') {
          const created = saleOwner.get((raw.payload as { id: string }).id) as { user: string; at: number } | undefined;
          verdict = created && created.user === user.username && at - created.at <= CASHIER_VOID_WINDOW_MS ? 'yes' : 'no';
        }
        if (verdict !== 'yes') {
          rejected.push({ id, reason: `${user.role} may not ${op} ${entity}` });
          continue;
        }
        insert.run(deviceId, id, entity, op, JSON.stringify(payload), at, user.username, now());
        accepted.push(id); // duplicates (retries) are ignored by the DB but still reported as accepted
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { accepted, rejected };
  };

  const pull = (user: AuthUser, url: URL) => {
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const deviceId = url.searchParams.get('deviceId') ?? '';
    const rows = db
      .prepare('SELECT seq, entity, op, payload, at FROM changes WHERE seq > ? AND device_id != ? ORDER BY seq LIMIT ?')
      .all(since, deviceId, PULL_LIMIT) as { seq: number; entity: string; op: string; payload: string; at: number }[];
    const hasMore = rows.length === PULL_LIMIT;
    const head = (db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM changes').get() as { m: number }).m;
    const changes = rows.flatMap((r) => {
      let payload: Record<string, unknown> | null = JSON.parse(r.payload) as Record<string, unknown>;
      if (user.role === 'cashier') payload = forCashier(r.entity, r.op, payload);
      return payload ? [{ seq: r.seq, entity: r.entity, op: r.op, payload, at: r.at }] : [];
    });
    return { changes, cursor: hasMore ? rows[rows.length - 1]!.seq : head, hasMore };
  };

  // ---- static app ------------------------------------------------------------------------

  const serveStatic = (res: ServerResponse, pathname: string, method: string): boolean => {
    if (!opts.staticDir) return false;
    const root = resolve(opts.staticDir);
    let file = resolve(join(root, normalize(decodeURIComponent(pathname))));
    if (!file.startsWith(root)) return false; // path traversal guard
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html'); // SPA fallback
    if (!existsSync(file)) return false;
    const size = statSync(file).size;
    const headers: Record<string, string | number> = {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Content-Length': size,
    };
    // the speech model files are large and rarely change: let browsers keep them
    if (/\/(models|ort)\//.test(pathname)) headers['Cache-Control'] = 'public, max-age=86400';
    res.writeHead(200, headers);
    if (method === 'HEAD') res.end();
    else createReadStream(file).pipe(res); // streamed, so a 90 MB model does not sit in memory
    return true;
  };

  // ---- router ------------------------------------------------------------------------------

  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', opts.corsOrigin ?? '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    try {
      if (!url.pathname.startsWith('/api/')) {
        if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(res, url.pathname, req.method)) return;
        throw new HttpError(404, 'Not found');
      }

      switch (route) {
        case 'GET /api/health':
          return send(res, 200, { ok: true });

        case 'GET /api/auth/status':
          return send(res, 200, { needsSetup: userCount() === 0 });

        case 'POST /api/auth/setup': {
          if (userCount() > 0) throw new HttpError(409, 'Setup has already been done');
          const b = await readJson(req);
          const username = validUsername(b.username);
          createUser(username, validPassword(b.password), 'admin');
          return send(res, 201, sessionFor({ username, role: 'admin' }));
        }

        case 'POST /api/auth/login': {
          const b = await readJson(req);
          const username = typeof b.username === 'string' ? b.username.toLowerCase() : '';
          const f = failures.get(username);
          if (f && f.until > now()) throw new HttpError(429, 'Too many failed attempts. Try again in a minute.');
          const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
            | { username: string; role: Role; salt: string; hash: string; disabled: number }
            | undefined;
          // always run scrypt so response time does not reveal whether the user exists
          const ok = row ? verifyPassword(String(b.password ?? ''), row.salt, row.hash) : (verifyPassword('x', '00', '00'), false);
          if (!row || !ok || row.disabled) {
            const count = (f?.count ?? 0) + 1;
            failures.set(username, { count, until: count >= 5 ? now() + 60_000 : 0 });
            throw new HttpError(401, 'Wrong username or password');
          }
          failures.delete(username);
          return send(res, 200, sessionFor({ username: row.username, role: row.role }));
        }

        case 'GET /api/auth/me':
          return send(res, 200, { user: authenticate(req) });

        case 'GET /api/users': {
          const u = authenticate(req);
          if (u.role !== 'admin') throw new HttpError(403, 'Admins only');
          return send(res, 200, { users: db.prepare('SELECT username, role, disabled, created_at FROM users ORDER BY username').all() });
        }

        case 'POST /api/users': {
          const u = authenticate(req);
          if (u.role !== 'admin') throw new HttpError(403, 'Admins only');
          const b = await readJson(req);
          const username = validUsername(b.username);
          const role = b.role as Role;
          if (!ROLES.includes(role)) throw new HttpError(400, 'Role must be cashier, manager or admin');
          if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'That username is taken');
          createUser(username, validPassword(b.password), role);
          return send(res, 201, { username, role });
        }

        case 'POST /api/users/disable': {
          const u = authenticate(req);
          if (u.role !== 'admin') throw new HttpError(403, 'Admins only');
          const b = await readJson(req);
          const target = validUsername(b.username);
          if (target === u.username) throw new HttpError(400, 'You cannot disable your own account');
          db.prepare('UPDATE users SET disabled = ? WHERE username = ?').run(b.disabled === false ? 0 : 1, target);
          return send(res, 200, { ok: true });
        }

        case 'POST /api/auth/password': {
          // you change your own password; you must know the current one
          const u = authenticate(req);
          const b = await readJson(req);
          const f = failures.get(u.username);
          if (f && f.until > now()) throw new HttpError(429, 'Too many failed attempts. Try again in a minute.');
          const row = db.prepare('SELECT salt, hash FROM users WHERE username = ?').get(u.username) as { salt: string; hash: string };
          if (!verifyPassword(String(b.currentPassword ?? ''), row.salt, row.hash)) {
            const count = (f?.count ?? 0) + 1;
            failures.set(u.username, { count, until: count >= 5 ? now() + 60_000 : 0 });
            throw new HttpError(403, 'Current password is wrong');
          }
          failures.delete(u.username);
          const next = validPassword(b.newPassword);
          if (next === b.currentPassword) throw new HttpError(400, 'Choose a password different from the current one');
          setPassword(u.username, next);
          return send(res, 200, sessionFor(u)); // this device stays signed in; all others must sign in again
        }

        case 'POST /api/users/password': {
          // an admin sets a new password for someone else (forgotten password)
          const u = authenticate(req);
          if (u.role !== 'admin') throw new HttpError(403, 'Admins only');
          const b = await readJson(req);
          const target = validUsername(b.username);
          if (target === u.username) throw new HttpError(400, 'Use "Change my password" for your own account');
          if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get(target)) throw new HttpError(404, 'No such user');
          setPassword(target, validPassword(b.newPassword));
          failures.delete(target);
          return send(res, 200, { ok: true });
        }

        case 'POST /api/sync':
          return send(res, 200, push(authenticate(req), await readJson(req)));

        case 'GET /api/sync':
          return send(res, 200, pull(authenticate(req), url));

        default:
          throw new HttpError(404, 'Not found');
      }
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      return send(res, 500, { error: 'Server error' });
    }
  };
}

export function listen(opts: AppOptions, port: number) {
  return createHttpServer(createApp(opts)).listen(port);
}
