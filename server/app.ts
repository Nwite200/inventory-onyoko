import { createServer as createHttpServer, type IncomingMessage, type RequestListener, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ROLES, canPush, hashPassword, signToken, verifyPassword, verifyToken, type Role } from './auth.ts';

const ADVANCED_TABLES = new Set([
  'serials', 'bins', 'binMovements', 'pickTasks', 'boms', 'productionOrders', 'assets', 'budgets',
  'employees', 'payslips', 'currencies', 'taxRates', 'bankAccounts', 'bankTransactions', 'approvals',
  'saleDocuments', 'customerPayments', 'categories',
]);

function isAdvancedPayload(table: unknown, record: unknown, op: string): boolean {
  if (typeof table !== 'string' || !ADVANCED_TABLES.has(table)) return false;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const r = record as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || r.id.length > 80) return false;
  if (op === 'upsert' && typeof r.at === 'number' && !Number.isFinite(r.at)) return false;
  return true;
}

const TOKEN_TTL_MS = 14 * 24 * 3600 * 1000;
const MAX_BODY = 2 * 1024 * 1024;
const PULL_LIMIT = 500;
const CASHIER_VOID_WINDOW_MS = 5 * 60 * 1000;
const ENTITIES = new Set([
  'product', 'stock_movement', 'sale', 'customer', 'location', 'supplier', 'purchase', 'transfer', 'lot',
  'expense', 'sale_return', 'cash_register', 'journal', 'advanced',
]);

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
  approvalThreshold?: number;
  geminiKey?: string;
  geminiModel?: string;
}

interface AuthUser {
  username: string;
  role: Role;
  businessId: string;
  /** the platform owner: the first admin on the server, who may add other businesses */
  isSuper: boolean;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
};

export function createApp(opts: AppOptions): RequestListener {
  const { db, secret } = opts;
  const now = opts.now ?? Date.now;
  const approvalThreshold = Math.max(0, opts.approvalThreshold ?? 0);
  const failures = new Map<string, { count: number; until: number }>();
  const aiUsage = new Map<string, { count: number; reset: number }>();

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
    const row = db.prepare('SELECT username, role, disabled, token_version, business_id, is_super FROM users WHERE username = ?').get(t.username) as
      | { username: string; role: Role; disabled: number; token_version: number; business_id: string; is_super: number }
      | undefined;
    if (!row || row.disabled) throw new HttpError(401, 'Account is disabled or does not exist');
    if (row.token_version !== t.version) throw new HttpError(401, 'Your password was changed. Please sign in again.');
    // role and business always come from the DB, never from the token
    return { username: row.username, role: row.role, businessId: row.business_id, isSuper: row.is_super === 1 };
  };

  const validUsername = (u: unknown): string => {
    if (typeof u !== 'string' || !/^[a-zA-Z0-9._-]{3,32}$/.test(u)) throw new HttpError(400, 'Username must be 3-32 letters, numbers, dot, dash or underscore');
    return u.toLowerCase();
  };
  const validPassword = (p: unknown): string => {
    if (typeof p !== 'string' || p.length < 8 || p.length > 200) throw new HttpError(400, 'Password must be at least 8 characters');
    return p;
  };

  const createUser = (username: string, password: string, role: Role, businessId: string, isSuper = false): void => {
    const { salt, hash } = hashPassword(password);
    db.prepare('INSERT INTO users (username, role, salt, hash, created_at, business_id, is_super) VALUES (?, ?, ?, ?, ?, ?, ?)').run(username, role, salt, hash, now(), businessId, isSuper ? 1 : 0);
  };

  const businessName = (id: string): string => (db.prepare('SELECT name FROM businesses WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? '';

  const sessionFor = (u: AuthUser) => {
    const v = (db.prepare('SELECT token_version FROM users WHERE username = ?').get(u.username) as { token_version: number }).token_version;
    return { token: signToken(secret, u.username, TOKEN_TTL_MS, now(), v), user: { ...u, business: { id: u.businessId, name: businessName(u.businessId) } } };
  };

  /** The account `target`, if the caller may manage it (same business; the platform owner may manage anyone). */
  const manageable = (caller: AuthUser, target: string): { username: string; business_id: string } | undefined => {
    const row = db.prepare('SELECT username, business_id FROM users WHERE username = ?').get(target) as { username: string; business_id: string } | undefined;
    return row && (caller.isSuper || row.business_id === caller.businessId) ? row : undefined;
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
    if (entity === 'advanced') {
      return isAdvancedPayload(o.table, o.record, op) ? null : 'bad advanced record';
    }
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
    if (entity === 'lot' && op === 'create') {
      if (typeof o.productId !== 'string' || typeof o.locationId !== 'string' || !(Number(o.qty) > 0) || !Number.isFinite(o.expiresAt)) return 'bad lot';
    }
    if (entity === 'transfer') {
      if (op === 'create' && (!goodItems(false) || typeof o.fromLocationId !== 'string' || typeof o.toLocationId !== 'string' || o.fromLocationId === o.toLocationId)) return 'bad transfer';
    }
    if (entity === 'expense' && op === 'create') {
      if (typeof o.category !== 'string' || !o.category.trim() || o.category.length > 80) return 'expense needs a category';
      if (!(Number(o.amount) > 0) || !Number.isFinite(Number(o.amount)) || !Number.isFinite(o.at)) return 'bad expense amount';
      if (typeof o.paymentMethod !== 'string' || !o.paymentMethod) return 'expense needs a payment method';
    }
    if (entity === 'sale_return' && op === 'create') {
      if (typeof o.saleId !== 'string' || !o.saleId || typeof o.saleNumber !== 'string') return 'refund needs its original sale';
      if (!(Number(o.totalRefunded) >= 0) || !Number.isFinite(o.at)) return 'bad refund total';
      if (!Array.isArray(o.items) || o.items.length === 0 || o.items.length > 200) return 'refund needs 1-200 items';
      for (const it of o.items as Record<string, unknown>[]) {
        if (!it || typeof it.productId !== 'string' || !(Number(it.qty) > 0) || !(Number(it.refundAmount) >= 0)) return 'bad refund item';
        if (it.condition !== 'restock' && it.condition !== 'damaged') return 'bad refund condition';
      }
    }    if (entity === 'cash_register') {
      if (!(Number(o.openingCash) >= 0) || !Number.isFinite(o.openedAt)) return 'bad register';
      if (op === 'close' && (!(Number(o.closingCash) >= 0) || !(Number(o.expectedCash) >= 0))) return 'bad register close';
    }
    if (entity === 'journal' && op === 'create') {
      if (typeof o.memo !== 'string' || !o.memo.trim() || o.memo.length > 300) return 'journal needs a description';
      if (typeof o.number !== 'string' || !Number.isFinite(o.date)) return 'bad journal header';
      if (!Array.isArray(o.lines) || o.lines.length < 2 || o.lines.length > 60) return 'journal needs 2-60 lines';
      let debit = 0;
      let credit = 0;
      for (const l of o.lines as Record<string, unknown>[]) {
        const dr = Number(l?.debit);
        const cr = Number(l?.credit);
        if (!l || typeof l.account !== 'string' || !/^\d{4}$/.test(l.account)) return 'bad journal account';
        if (!Number.isFinite(dr) || !Number.isFinite(cr) || dr < 0 || cr < 0) return 'bad journal amount';
        if (dr > 0 && cr > 0) return 'journal line has both debit and credit';
        if (dr === 0 && cr === 0) return 'empty journal line';
        debit += dr;
        credit += cr;
      }
      if (Math.abs(debit - credit) >= 0.005) return 'journal is not balanced';
    }
    if (entity === 'advanced') {
      const table = o.table;
      const record = o.record;
      if (!isAdvancedPayload(table, record, op)) return 'bad advanced record';
    }
    return null;
  };

  /** Cashiers keep the shelves right but never see what the shop pays. Returns null = send nothing. */
  const forCashier = (entity: string, op: string, payload: Record<string, unknown>): Record<string, unknown> | null => {
    if (entity === 'supplier') return null;
    if (entity === 'expense' || entity === 'journal') return null; // financial detail stays with managers
    if (entity === 'advanced') {
      // tills still need serials, bins, tax rules and currencies to complete a sale
      const table = String(payload.table ?? '');
      return ['serials', 'bins', 'binMovements', 'taxRates', 'currencies', 'approvals'].includes(table) ? payload : null;
    }
    if (entity === 'purchase') {
      if (op === 'pay') return null;
      const items = ((payload.items ?? []) as { productId: string; qty: number }[]).map((i) => ({ productId: i.productId, qty: i.qty }));
      return { id: payload.id, locationId: payload.locationId, items }; // no number, supplier, cost or total
    }
    if (entity === 'product') {
      const { cost: _cost, costAt: _costAt, ...rest } = payload;
      return rest;
    }
    if (entity === 'sale') {
      // sale lines carry the cost at the time of sale; a cashier must not see it
      const items = ((payload.items ?? []) as Record<string, unknown>[]).map(({ cost: _cost, ...rest }) => rest);
      return { ...payload, items };
    }
    return payload;
  };

  const push = (user: AuthUser, body: Record<string, unknown>) => {
    const deviceId = body.deviceId;
    const items = body.items;
    if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 64) throw new HttpError(400, 'deviceId is required');
    if (!Array.isArray(items) || items.length > 200) throw new HttpError(400, 'items must be an array of at most 200');

    const insert = db.prepare(
      'INSERT OR IGNORE INTO changes (device_id, client_id, entity, op, payload, at, user, received_at, business_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const saleOwner = db.prepare(
      "SELECT user, at FROM changes WHERE business_id = ? AND entity = 'sale' AND op = 'create' AND json_extract(payload, '$.id') = ? LIMIT 1",
    );
    const sentTransfer = db.prepare(
      "SELECT payload FROM changes WHERE business_id = ? AND entity = 'transfer' AND op = 'create' AND json_extract(payload, '$.id') = ? LIMIT 1",
    );
    const seenChange = db.prepare('SELECT 1 AS x FROM changes WHERE device_id = ? AND client_id = ?');
    const saleById = db.prepare(
      "SELECT payload FROM changes WHERE business_id = ? AND entity = 'sale' AND op = 'create' AND json_extract(payload, '$.id') = ? LIMIT 1",
    );
    const returnsForSale = db.prepare(
      "SELECT payload FROM changes WHERE business_id = ? AND entity = 'sale_return' AND op = 'create' AND json_extract(payload, '$.saleId') = ?",
    );
    const accepted: number[] = [];
    const rejected: { id: number; reason: string }[] = [];
    const approvedFor = db.prepare(
      `SELECT 1 AS ok FROM changes
       WHERE business_id = ? AND entity = 'advanced' AND op = 'upsert'
         AND json_extract(payload, '$.table') = 'approvals'
         AND json_extract(payload, '$.record.kind') = ?
         AND json_extract(payload, '$.record.entityId') = ?
         AND json_extract(payload, '$.record.status') = 'approved'
         AND CAST(json_extract(payload, '$.record.amount') AS REAL) >= ?
       LIMIT 1`,
    );

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
        // A retry of a change the server already stored is accepted silently (never applied twice).
        if (seenChange.get(deviceId, id)) {
          accepted.push(id);
          continue;
        }
        if (entity === 'sale_return' && op === 'create') {
          // Refunds may not exceed what was sold on the original sale, counting earlier refunds.
          const refund = raw.payload as { saleId: string; items: { productId: string; qty: number }[]; totalRefunded?: number };
          const soldRow = saleById.get(user.businessId, refund.saleId) as { payload: string } | undefined;
          if (!soldRow) {
            rejected.push({ id, reason: 'refund refers to a sale the server has not received' });
            continue;
          }
          const sold = (JSON.parse(soldRow.payload) as { items: { productId: string; qty: number }[] }).items;
          const soldQty = new Map<string, number>();
          for (const it of sold) soldQty.set(it.productId, (soldQty.get(it.productId) ?? 0) + Number(it.qty));
          const already = new Map<string, number>();
          for (const row of returnsForSale.all(user.businessId, refund.saleId) as { payload: string }[]) {
            const prior = JSON.parse(row.payload) as { items: { productId: string; qty: number }[] };
            for (const it of prior.items) already.set(it.productId, (already.get(it.productId) ?? 0) + Number(it.qty));
          }
          const excessive = refund.items.some((it) => Number(it.qty) > (soldQty.get(it.productId) ?? 0) - (already.get(it.productId) ?? 0) + 0.0001);
          if (excessive) {
            rejected.push({ id, reason: 'refund exceeds the quantity sold or already refunded' });
            continue;
          }
          if (approvalThreshold > 0 && Number(refund.totalRefunded ?? 0) > approvalThreshold && !approvedFor.get(user.businessId, 'refund', refund.saleId, Number(refund.totalRefunded ?? 0))) {
            rejected.push({ id, reason: 'this refund needs an approved manager request' });
            continue;
          }
        }
        if (entity === 'sale' && op === 'void' && approvalThreshold > 0) {
          const voidedId = String((raw.payload as { id: string }).id);
          const soldRow = saleById.get(user.businessId, voidedId) as { payload: string } | undefined;
          const total = soldRow ? Number((JSON.parse(soldRow.payload) as { total?: number }).total ?? 0) : 0;
          if (total > approvalThreshold && !approvedFor.get(user.businessId, 'void', voidedId, total)) {
            rejected.push({ id, reason: 'this void needs an approved manager request' });
            continue;
          }
        }
        if (entity === 'expense' && op === 'create' && approvalThreshold > 0) {
          const e = raw.payload as { id: string; amount: number };
          if (Number(e.amount) > approvalThreshold && !approvedFor.get(user.businessId, 'expense', e.id, Number(e.amount))) {
            rejected.push({ id, reason: 'this expense needs an approved manager request' });
            continue;
          }
        }
        if (entity === 'journal' && op === 'create' && approvalThreshold > 0) {
          const j = raw.payload as { approvalKey?: string; lines: { debit: number; credit: number }[] };
          const total = (j.lines ?? []).reduce((sum, l) => sum + Number(l.debit || 0), 0);
          if (total > approvalThreshold && (!j.approvalKey || !approvedFor.get(user.businessId, 'journal', j.approvalKey, total))) {
            rejected.push({ id, reason: 'this journal needs an approved manager request' });
            continue;
          }
        }
        if (entity === 'stock_movement' && op === 'create' && approvalThreshold > 0) {
          const m = raw.payload as { reason?: string; value?: number; approvalKey?: string };
          const value = Number(m.value ?? 0);
          if ((m.reason ?? '').startsWith('adjustment') && value > approvalThreshold && (!m.approvalKey || !approvedFor.get(user.businessId, 'stock_adjustment', m.approvalKey, value))) {
            rejected.push({ id, reason: 'this stock adjustment needs an approved manager request' });
            continue;
          }
        }
        let payload = raw.payload as Record<string, unknown>;
        if (entity === 'transfer' && op === 'receive') {
          // stock arrives exactly as it was sent, whatever the device claims
          const sent = sentTransfer.get(user.businessId, String(payload.id)) as { payload: string } | undefined;
          if (!sent) {
            rejected.push({ id, reason: 'no such transfer was sent' });
            continue;
          }
          const t = JSON.parse(sent.payload) as { id: string; toLocationId: string; items: unknown[] };
          payload = { id: t.id, toLocationId: t.toLocationId, items: t.items };
        }
        let verdict = canPush(user.role, entity, op);
        if (verdict !== 'yes' && user.role === 'cashier' && entity === 'advanced') {
          const advanced = payload as { table?: string; record?: { status?: string } };
          // a till may ask for approval; only a manager can publish the decision
          if (advanced.table === 'approvals' && advanced.record?.status === 'pending') verdict = 'yes';
        }
        if (verdict === 'check-void') {
          const created = saleOwner.get(user.businessId, (raw.payload as { id: string }).id) as { user: string; at: number } | undefined;
          verdict = created && created.user === user.username && at - created.at <= CASHIER_VOID_WINDOW_MS ? 'yes' : 'no';
        }
        if (verdict !== 'yes') {
          rejected.push({ id, reason: `${user.role} may not ${op} ${entity}` });
          continue;
        }
        insert.run(deviceId, id, entity, op, JSON.stringify(payload), at, user.username, now(), user.businessId);
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
      .prepare('SELECT seq, entity, op, payload, at FROM changes WHERE business_id = ? AND seq > ? AND device_id != ? ORDER BY seq LIMIT ?')
      .all(user.businessId, since, deviceId, PULL_LIMIT) as { seq: number; entity: string; op: string; payload: string; at: number }[];
    const hasMore = rows.length === PULL_LIMIT;
    const head = (db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM changes WHERE business_id = ?').get(user.businessId) as { m: number }).m;
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
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    if (req.url?.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
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

        case 'GET /api/policy': {
          authenticate(req);
          return send(res, 200, { approvalThreshold });
        }

        case 'POST /api/ai/parse': {
          const u = authenticate(req);
          if (!opts.geminiKey) throw new HttpError(503, 'Server AI is not configured. Set GEMINI_API_KEY on the server.');
          const b = await readJson(req);
          const text = typeof b.text === 'string' ? b.text.trim() : '';
          if (!text) throw new HttpError(400, 'Command text is required');
          if (text.length > 2000) throw new HttpError(400, 'Command text is too long');
          const slot = aiUsage.get(u.username);
          if (slot && slot.reset > now() && slot.count >= 30) throw new HttpError(429, 'AI rate limit reached. Try again in a minute.');
          aiUsage.set(u.username, { count: slot && slot.reset > now() ? slot.count + 1 : 1, reset: slot && slot.reset > now() ? slot.reset : now() + 60_000 });
          const system = 'Convert a shop command into JSON only. Never invent products or prices. Return {"type":"unknown"} if unsure. Allowed types: sell, add_stock, check_stock, set_price, report_today, business_summary, top_products, low_stock, expiring, receive_purchase, pay_supplier, supplier_balance, transfer, receive_transfer.';
          let response: Response;
          try {
            response = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.geminiModel ?? 'gemini-2.0-flash')}:generateContent`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.geminiKey },
                body: JSON.stringify({
                  systemInstruction: { parts: [{ text: system }] },
                  contents: [{ role: 'user', parts: [{ text }] }],
                  generationConfig: { responseMimeType: 'application/json', temperature: 0 },
                }),
              },
            );
          } catch {
            throw new HttpError(502, 'The AI provider could not be reached');
          }
          if (!response.ok) throw new HttpError(502, `AI provider returned ${response.status}`);
          const data = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
          return send(res, 200, { text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '' });
        }

        case 'GET /api/auth/status':
          return send(res, 200, { needsSetup: userCount() === 0 });

        case 'POST /api/auth/setup': {
          if (userCount() > 0) throw new HttpError(409, 'Setup has already been done');
          const b = await readJson(req);
          const username = validUsername(b.username);
          const name = typeof b.businessName === 'string' && b.businessName.trim() ? b.businessName.trim().slice(0, 80) : 'My business';
          db.prepare("INSERT OR IGNORE INTO businesses (id, name, created_at) VALUES ('main', ?, ?)").run(name, now());
          createUser(username, validPassword(b.password), 'admin', 'main', true);
          return send(res, 201, sessionFor({ username, role: 'admin', businessId: 'main', isSuper: true }));
        }

        case 'POST /api/auth/login': {
          const b = await readJson(req);
          const username = typeof b.username === 'string' ? b.username.toLowerCase() : '';
          const f = failures.get(username);
          if (f && f.until > now()) throw new HttpError(429, 'Too many failed attempts. Try again in a minute.');
          const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
            | { username: string; role: Role; salt: string; hash: string; disabled: number; business_id: string; is_super: number }
            | undefined;
          // always run scrypt so response time does not reveal whether the user exists
          const ok = row ? verifyPassword(String(b.password ?? ''), row.salt, row.hash) : (verifyPassword('x', '00', '00'), false);
          if (!row || !ok || row.disabled) {
            const count = (f?.count ?? 0) + 1;
            failures.set(username, { count, until: count >= 5 ? now() + 60_000 : 0 });
            throw new HttpError(401, 'Wrong username or password');
          }
          failures.delete(username);
          return send(res, 200, sessionFor({ username: row.username, role: row.role, businessId: row.business_id, isSuper: row.is_super === 1 }));
        }

        case 'GET /api/auth/me': {
          const u = authenticate(req);
          return send(res, 200, { user: { ...u, business: { id: u.businessId, name: businessName(u.businessId) } } });
        }

        case 'GET /api/users': {
          const u = authenticate(req);
          if (u.role !== 'admin') throw new HttpError(403, 'Admins only');
          return send(res, 200, { users: db.prepare('SELECT username, role, disabled, created_at FROM users WHERE business_id = ? ORDER BY username').all(u.businessId) });
        }

        case 'POST /api/users': {
          const u = authenticate(req);
          if (u.role !== 'admin') throw new HttpError(403, 'Admins only');
          const b = await readJson(req);
          const username = validUsername(b.username);
          const role = b.role as Role;
          if (!ROLES.includes(role)) throw new HttpError(400, 'Role must be cashier, manager or admin');
          if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'That username is taken');
          createUser(username, validPassword(b.password), role, u.businessId);
          return send(res, 201, { username, role });
        }

        case 'POST /api/users/disable': {
          const u = authenticate(req);
          if (u.role !== 'admin') throw new HttpError(403, 'Admins only');
          const b = await readJson(req);
          const target = validUsername(b.username);
          if (target === u.username) throw new HttpError(400, 'You cannot disable your own account');
          if (!manageable(u, target)) throw new HttpError(404, 'No such user');
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
          if (!manageable(u, target)) throw new HttpError(404, 'No such user');
          setPassword(target, validPassword(b.newPassword));
          failures.delete(target);
          return send(res, 200, { ok: true });
        }

        case 'GET /api/businesses': {
          const u = authenticate(req);
          if (!u.isSuper) throw new HttpError(403, 'Only the platform owner can manage businesses');
          return send(res, 200, {
            businesses: db.prepare(
              'SELECT b.id, b.name, b.created_at, (SELECT COUNT(*) FROM users x WHERE x.business_id = b.id) AS users FROM businesses b ORDER BY b.created_at',
            ).all(),
          });
        }

        case 'GET /api/branding': {
          const u = authenticate(req);
          const row = db.prepare('SELECT branding FROM businesses WHERE id = ?').get(u.businessId) as { branding: string } | undefined;
          let branding: unknown = {};
          try { branding = JSON.parse(row?.branding ?? '{}'); } catch { branding = {}; }
          return send(res, 200, { branding });
        }

        case 'PUT /api/branding': {
          const u = authenticate(req);
          if (u.role !== 'admin') throw new HttpError(403, 'Only a business administrator can publish tenant branding');
          const b = await readJson(req);
          const branding = b.branding;
          if (!branding || typeof branding !== 'object' || Array.isArray(branding)) throw new HttpError(400, 'branding must be an object');
          const text = JSON.stringify(branding);
          if (text.length > 1_500_000) throw new HttpError(400, 'Branding payload is too large (logos should be under 300 KB each)');
          db.prepare('UPDATE businesses SET branding = ? WHERE id = ?').run(text, u.businessId);
          return send(res, 200, { ok: true });
        }

        case 'GET /api/admin/overview': {
          const u = authenticate(req);
          if (!u.isSuper) throw new HttpError(403, 'Platform owner only');
          const businesses = db.prepare(
            `SELECT b.id, b.name, b.created_at,
               (SELECT COUNT(*) FROM users x WHERE x.business_id = b.id) AS users,
               (SELECT COUNT(*) FROM changes c WHERE c.business_id = b.id) AS changes,
               (SELECT MAX(received_at) FROM changes c WHERE c.business_id = b.id) AS last_change
             FROM businesses b ORDER BY b.created_at`,
          ).all();
          const totals = db.prepare(
            `SELECT (SELECT COUNT(*) FROM businesses) AS businesses,
                    (SELECT COUNT(*) FROM users) AS users,
                    (SELECT COUNT(*) FROM changes) AS changes`,
          ).get();
          let dbBytes = 0;
          try {
            const pages = db.prepare('PRAGMA page_count').get() as { page_count: number } | undefined;
            const size = db.prepare('PRAGMA page_size').get() as { page_size: number } | undefined;
            dbBytes = (pages?.page_count ?? 0) * (size?.page_size ?? 0);
          } catch {
            dbBytes = 0;
          }
          return send(res, 200, {
            totals,
            businesses,
            health: {
              uptimeSeconds: Math.round(process.uptime()),
              memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
              dbBytes,
              node: process.version,
            },
          });
        }

        case 'GET /api/admin/audit': {
          const u = authenticate(req);
          if (!u.isSuper) throw new HttpError(403, 'Platform owner only');
          const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 40));
          const events = db.prepare(
            `SELECT c.seq, c.entity, c.op, c.at, c.user, c.business_id, b.name AS business
             FROM changes c LEFT JOIN businesses b ON b.id = c.business_id
             ORDER BY c.seq DESC LIMIT ?`,
          ).all(limit);
          return send(res, 200, { events });
        }

        case 'POST /api/businesses': {
          // the platform owner opens a new, separate business and its first admin
          const u = authenticate(req);
          if (!u.isSuper) throw new HttpError(403, 'Only the platform owner can manage businesses');
          const b = await readJson(req);
          const name = typeof b.name === 'string' ? b.name.trim() : '';
          if (!name || name.length > 80) throw new HttpError(400, 'Business name is required (up to 80 characters)');
          const adminUsername = validUsername(b.adminUsername);
          const adminPassword = validPassword(b.adminPassword);
          if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(adminUsername)) throw new HttpError(409, 'That username is taken');
          const id = randomUUID();
          db.exec('BEGIN');
          try {
            db.prepare('INSERT INTO businesses (id, name, created_at) VALUES (?, ?, ?)').run(id, name, now());
            createUser(adminUsername, adminPassword, 'admin', id);
            db.exec('COMMIT');
          } catch (e) {
            db.exec('ROLLBACK');
            throw e;
          }
          return send(res, 201, { id, name, adminUsername });
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
