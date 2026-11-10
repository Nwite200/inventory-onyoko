import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

export type Role = 'cashier' | 'manager' | 'admin';
export const ROLES: Role[] = ['cashier', 'manager', 'admin'];

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): { salt: string; hash: string } {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const a = Buffer.from(scryptSync(password, salt, 64).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

const b64 = (s: string): string => Buffer.from(s).toString('base64url');

/** `version` is the account's token_version: changing a password bumps it, which ends every older session. */
export function signToken(secret: string, username: string, ttlMs: number, now = Date.now(), version = 0): string {
  const body = b64(JSON.stringify({ u: username, exp: now + ttlMs, v: version }));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(secret: string, token: string, now = Date.now()): { username: string; version: number } | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { u, exp, v } = JSON.parse(Buffer.from(body, 'base64url').toString()) as { u: string; exp: number; v?: number };
    return typeof u === 'string' && typeof exp === 'number' && exp > now ? { username: u, version: typeof v === 'number' ? v : 0 } : null;
  } catch {
    return null;
  }
}

/** What each role may push. Enforced on the server, so a tampered client cannot bypass it. */
export function canPush(role: Role, entity: string, op: string): 'yes' | 'no' | 'check-void' {
  if (role === 'admin') return 'yes';
  if (entity === 'location') return 'no'; // only the owner opens new shops
  if (role === 'manager') return 'yes';
  // cashier
  if (entity === 'sale' && op === 'create') return 'yes';
  if (entity === 'customer' && op === 'create') return 'yes';
  // voice "undo" lets a cashier cancel a sale they just made; the server checks that below
  if (entity === 'sale' && op === 'void') return 'check-void';
  return 'no';
}
