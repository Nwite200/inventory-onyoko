import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { openDb } from './db.ts';
import { createApp } from './app.ts';

let server: Server;
let base: string;
let clock = 1_000_000;

beforeAll(async () => {
  const db = openDb(':memory:');
  server = createServer(createApp({ db, secret: 'test-secret', now: () => clock }));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const sale = (id: string, at = clock) => ({
  id: 1, entity: 'sale', op: 'create', at,
  payload: { id, items: [{ productId: 'p1', qty: 1, price: 100 }], total: 100 },
});

let admin = '';
let manager = '';
let cashier = '';

describe('accounts', () => {
  it('needs setup first, then locks setup', async () => {
    expect((await call('GET', '/api/auth/status')).body.needsSetup).toBe(true);
    const r = await call('POST', '/api/auth/setup', { username: 'Owner', password: 'correct-horse' });
    expect(r.status).toBe(201);
    admin = r.body.token;
    expect((await call('GET', '/api/auth/status')).body.needsSetup).toBe(false);
    expect((await call('POST', '/api/auth/setup', { username: 'x1x', password: 'another-pass' })).status).toBe(409);
  });

  it('rejects weak passwords and bad usernames', async () => {
    expect((await call('POST', '/api/users', { username: 'amaka', password: 'short', role: 'cashier' }, admin)).status).toBe(400);
    expect((await call('POST', '/api/users', { username: 'a b', password: 'long-enough-pw', role: 'cashier' }, admin)).status).toBe(400);
    expect((await call('POST', '/api/users', { username: 'amaka', password: 'long-enough-pw', role: 'king' }, admin)).status).toBe(400);
  });

  it('admin creates users who can log in; only admins manage users', async () => {
    expect((await call('POST', '/api/users', { username: 'boss2', password: 'long-enough-pw', role: 'manager' }, admin)).status).toBe(201);
    expect((await call('POST', '/api/users', { username: 'amaka', password: 'long-enough-pw', role: 'cashier' }, admin)).status).toBe(201);
    manager = (await call('POST', '/api/auth/login', { username: 'boss2', password: 'long-enough-pw' })).body.token;
    cashier = (await call('POST', '/api/auth/login', { username: 'AMAKA', password: 'long-enough-pw' })).body.token;
    expect(manager && cashier).toBeTruthy();
    expect((await call('GET', '/api/users', undefined, cashier)).status).toBe(403);
    expect((await call('POST', '/api/users', { username: 'zed', password: 'long-enough-pw', role: 'admin' }, manager)).status).toBe(403);
    expect((await call('GET', '/api/users', undefined, admin)).body.users).toHaveLength(3);
  });

  it('rejects wrong passwords, forged tokens and locks out brute force', async () => {
    expect((await call('POST', '/api/auth/login', { username: 'amaka', password: 'nope-nope-nope' })).status).toBe(401);
    expect((await call('GET', '/api/auth/me')).status).toBe(401);
    expect((await call('GET', '/api/auth/me', undefined, cashier + 'x')).status).toBe(401);
    for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { username: 'ghost', password: 'whatever-pw' });
    expect((await call('POST', '/api/auth/login', { username: 'ghost', password: 'whatever-pw' })).status).toBe(429);
  });

  it('expired tokens stop working', async () => {
    const r = await call('POST', '/api/auth/login', { username: 'amaka', password: 'long-enough-pw' });
    clock += 15 * 24 * 3600 * 1000;
    expect((await call('GET', '/api/auth/me', undefined, r.body.token)).status).toBe(401);
    clock = 1_000_000;
  });

  it('a disabled user is cut off immediately', async () => {
    await call('POST', '/api/users', { username: 'temp1', password: 'long-enough-pw', role: 'cashier' }, admin);
    const t = (await call('POST', '/api/auth/login', { username: 'temp1', password: 'long-enough-pw' })).body.token;
    expect((await call('GET', '/api/auth/me', undefined, t)).status).toBe(200);
    await call('POST', '/api/users/disable', { username: 'temp1' }, admin);
    expect((await call('GET', '/api/auth/me', undefined, t)).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { username: 'temp1', password: 'long-enough-pw' })).status).toBe(401);
  });
});

describe('passwords', () => {
  const login = async (username: string, password: string) => (await call('POST', '/api/auth/login', { username, password })).body.token as string;

  it('a user changes their own password; other sessions end, this one continues', async () => {
    await call('POST', '/api/users', { username: 'chidi', password: 'old-password-1', role: 'cashier' }, admin);
    const phone = await login('chidi', 'old-password-1');
    const till = await login('chidi', 'old-password-1');
    expect((await call('POST', '/api/auth/password', { currentPassword: 'wrong-password', newPassword: 'new-password-2' }, till)).status).toBe(403);
    expect((await call('POST', '/api/auth/password', { currentPassword: 'old-password-1', newPassword: 'short' }, till)).status).toBe(400);
    expect((await call('POST', '/api/auth/password', { currentPassword: 'old-password-1', newPassword: 'old-password-1' }, till)).status).toBe(400);
    const ok = await call('POST', '/api/auth/password', { currentPassword: 'old-password-1', newPassword: 'new-password-2' }, till);
    expect(ok.status).toBe(200);
    expect((await call('GET', '/api/auth/me', undefined, ok.body.token)).status).toBe(200); // the device that changed it
    expect((await call('GET', '/api/auth/me', undefined, phone)).status).toBe(401); // another device is signed out
    expect((await call('GET', '/api/auth/me', undefined, till)).status).toBe(401); // the old token too
    expect((await call('POST', '/api/auth/login', { username: 'chidi', password: 'old-password-1' })).status).toBe(401);
    expect(await login('chidi', 'new-password-2')).toBeTruthy();
  });

  it('an admin resets a forgotten password; only admins, and not their own', async () => {
    await call('POST', '/api/users', { username: 'ngozi', password: 'forgotten-pw-1', role: 'cashier' }, admin);
    const old = await login('ngozi', 'forgotten-pw-1');
    expect((await call('POST', '/api/users/password', { username: 'ngozi', newPassword: 'fresh-password-3' }, cashier)).status).toBe(403);
    expect((await call('POST', '/api/users/password', { username: 'ngozi', newPassword: 'fresh-password-3' }, manager)).status).toBe(403);
    expect((await call('POST', '/api/users/password', { username: 'nobody1', newPassword: 'fresh-password-3' }, admin)).status).toBe(404);
    expect((await call('POST', '/api/users/password', { username: 'ngozi', newPassword: 'short' }, admin)).status).toBe(400);
    expect((await call('POST', '/api/users/password', { username: 'owner', newPassword: 'fresh-password-3' }, admin)).status).toBe(400); // own account
    expect((await call('POST', '/api/users/password', { username: 'ngozi', newPassword: 'fresh-password-3' }, admin)).status).toBe(200);
    expect((await call('GET', '/api/auth/me', undefined, old)).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { username: 'ngozi', password: 'forgotten-pw-1' })).status).toBe(401);
    expect(await login('ngozi', 'fresh-password-3')).toBeTruthy();
  });
});

describe('sync', () => {
  it('requires sign-in', async () => {
    expect((await call('POST', '/api/sync', { deviceId: 'd', items: [] })).status).toBe(401);
  });

  it('push is idempotent: retries never duplicate', async () => {
    const batch = { deviceId: 'dev-A', items: [sale('s1')] };
    const a = await call('POST', '/api/sync', batch, cashier);
    const b = await call('POST', '/api/sync', batch, cashier);
    expect(a.body.accepted).toEqual([1]);
    expect(b.body.accepted).toEqual([1]);
    const pulled = await call('GET', '/api/sync?since=0&deviceId=dev-B', undefined, manager);
    expect(pulled.body.changes.filter((c: any) => c.payload.id === 's1')).toHaveLength(1);
  });

  it('a device does not get its own changes back, but others do', async () => {
    const own = await call('GET', '/api/sync?since=0&deviceId=dev-A', undefined, manager);
    expect(own.body.changes).toHaveLength(0);
    const other = await call('GET', '/api/sync?since=0&deviceId=dev-B', undefined, manager);
    expect(other.body.changes.length).toBeGreaterThan(0);
    expect(other.body.cursor).toBeGreaterThan(0);
  });

  it('cashiers cannot push product or stock changes; managers can', async () => {
    const items = [
      { id: 10, entity: 'product', op: 'create', at: clock, payload: { id: 'p1', name: 'Rice', price: 5, cost: 3, stock: 1 } },
      { id: 11, entity: 'stock_movement', op: 'create', at: clock, payload: { id: 'm1', productId: 'p1', delta: 5 } },
      { id: 12, entity: 'product', op: 'update', at: clock, payload: { id: 'p1', price: 1 } },
    ];
    const c = await call('POST', '/api/sync', { deviceId: 'dev-C', items }, cashier);
    expect(c.body.accepted).toEqual([]);
    expect(c.body.rejected).toHaveLength(3);
    const m = await call('POST', '/api/sync', { deviceId: 'dev-M', items }, manager);
    expect(m.body.accepted).toEqual([10, 11, 12]);
  });

  it('cashiers do not receive cost prices', async () => {
    const asCashier = await call('GET', '/api/sync?since=0&deviceId=dev-X', undefined, cashier);
    const prod = asCashier.body.changes.find((c: any) => c.entity === 'product' && c.op === 'create');
    expect(prod.payload.name).toBe('Rice');
    expect('cost' in prod.payload).toBe(false);
    const asManager = await call('GET', '/api/sync?since=0&deviceId=dev-X', undefined, manager);
    expect(asManager.body.changes.find((c: any) => c.entity === 'product' && c.op === 'create').payload.cost).toBe(3);
  });

  it('a cashier may void their own recent sale, not an old one or someone else\'s', async () => {
    const mk = (id: number, saleId: string, at: number) => ({ id, entity: 'sale', op: 'void', at, payload: { id: saleId } });
    await call('POST', '/api/sync', { deviceId: 'dev-A', items: [{ ...sale('s2', clock), id: 2 }] }, cashier);
    await call('POST', '/api/sync', { deviceId: 'dev-M', items: [{ ...sale('s3', clock), id: 20 }] }, manager);

    const own = await call('POST', '/api/sync', { deviceId: 'dev-A', items: [mk(3, 's2', clock + 60_000)] }, cashier);
    expect(own.body.accepted).toEqual([3]);
    const late = await call('POST', '/api/sync', { deviceId: 'dev-A', items: [mk(4, 's2', clock + 10 * 60_000)] }, cashier);
    expect(late.body.rejected).toHaveLength(1);
    const theirs = await call('POST', '/api/sync', { deviceId: 'dev-A', items: [mk(5, 's3', clock + 1000)] }, cashier);
    expect(theirs.body.rejected).toHaveLength(1);
  });

  it('rejects malformed items without breaking the batch', async () => {
    const r = await call(
      'POST',
      '/api/sync',
      {
        deviceId: 'dev-A',
        items: [
          { id: 30, entity: 'sale', op: 'create', at: clock, payload: { id: 's9', items: [] } },
          { id: 31, entity: 'hacker', op: 'create', at: clock, payload: { id: 'x' } },
          { ...sale('s10'), id: 32 },
        ],
      },
      manager,
    );
    expect(r.body.accepted).toEqual([32]);
    expect(r.body.rejected.map((x: any) => x.id)).toEqual([30, 31]); // empty sale and unknown entity are both refused, the valid one still lands
  });

  it('pages through large histories', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({
      id: 1000 + i, entity: 'customer', op: 'create', at: clock, payload: { id: `c${i}`, name: `Customer ${i}` },
    }));
    for (let k = 0; k < 3; k++) {
      const batch = items.map((it) => ({ ...it, id: it.id + k * 1000, payload: { id: `c${k}-${it.payload.id}`, name: it.payload.name } }));
      await call('POST', '/api/sync', { deviceId: 'dev-big', items: batch }, manager);
    }
    let cursor = 0;
    let total = 0;
    let pages = 0;
    for (;;) {
      const r = await call('GET', `/api/sync?since=${cursor}&deviceId=dev-reader`, undefined, manager);
      total += r.body.changes.length;
      cursor = r.body.cursor;
      pages++;
      if (!r.body.hasMore) break;
    }
    expect(pages).toBeGreaterThan(1);
    expect(total).toBeGreaterThanOrEqual(600);
  });
});

describe('transfers', () => {
  const push = (items: unknown[], token = manager) => call('POST', '/api/sync', { deviceId: 'dev-tr', items }, token);
  it('a receipt must match a real send, and always uses what was really sent', async () => {
    const send = { id: 901, entity: 'transfer', op: 'create', at: clock, payload: { id: 'tr1', fromLocationId: 'main', toLocationId: 'b', items: [{ productId: 'p1', qty: 5 }] } };
    expect((await push([send])).body.accepted).toEqual([901]);
    const forged = { id: 902, entity: 'transfer', op: 'receive', at: clock, payload: { id: 'tr-never-sent', toLocationId: 'b', items: [{ productId: 'p1', qty: 500 }] } };
    expect((await push([forged])).body.rejected[0].reason).toMatch(/no such transfer/);
    const inflated = { id: 903, entity: 'transfer', op: 'receive', at: clock, payload: { id: 'tr1', toLocationId: 'b', items: [{ productId: 'p1', qty: 500 }] } };
    expect((await push([inflated])).body.accepted).toEqual([903]);
    let since = 0;
    let all: any[] = [];
    for (;;) {
      const page = (await call('GET', `/api/sync?since=${since}&deviceId=other`, undefined, admin)).body;
      all = all.concat(page.changes);
      since = page.cursor;
      if (!page.hasMore) break;
    }
    const pulled = all.filter((c) => c.entity === 'transfer' && c.op === 'receive');
    expect(pulled[0].payload.items).toEqual([{ productId: 'p1', qty: 5 }]); // not 500
  });
  it('only the owner opens shops; cashiers cannot send transfers or purchases', async () => {
    const loc = { id: 904, entity: 'location', op: 'create', at: clock, payload: { id: 'l1', name: 'Branch' } };
    expect((await push([loc], manager)).body.rejected).toHaveLength(1);
    expect((await push([loc], admin)).body.accepted).toEqual([904]);
    const pur = { id: 905, entity: 'purchase', op: 'create', at: clock, payload: { id: 'pu1', locationId: 'main', total: 10, paid: 0, items: [{ productId: 'p1', qty: 1, cost: 10 }] } };
    expect((await push([pur], cashier)).body.rejected).toHaveLength(1);
  });
});

describe('several businesses', () => {
  let rival = ''; // admin of the second business
  let rivalCashier = '';
  const pushAs = (token: string, items: unknown[], deviceId = 'dev-b') => call('POST', '/api/sync', { deviceId, items }, token);
  const pullAll = async (token: string, deviceId = 'puller') => {
    let since = 0;
    let all: any[] = [];
    for (;;) {
      const page = (await call('GET', `/api/sync?since=${since}&deviceId=${deviceId}`, undefined, token)).body;
      all = all.concat(page.changes);
      since = page.cursor;
      if (!page.hasMore) break;
    }
    return all;
  };

  it('only the platform owner can open businesses', async () => {
    expect((await call('GET', '/api/businesses', undefined, manager)).status).toBe(403);
    expect((await call('POST', '/api/businesses', { name: 'X', adminUsername: 'zed1', adminPassword: 'long-enough-pw' }, manager)).status).toBe(403);
    const r = await call('POST', '/api/businesses', { name: 'Rival Stores', adminUsername: 'rivalboss', adminPassword: 'long-enough-pw' }, admin);
    expect(r.status).toBe(201);
    expect((await call('POST', '/api/businesses', { name: 'Again', adminUsername: 'rivalboss', adminPassword: 'long-enough-pw' }, admin)).status).toBe(409);
    expect((await call('GET', '/api/businesses', undefined, admin)).body.businesses).toHaveLength(2);
    rival = (await call('POST', '/api/auth/login', { username: 'rivalboss', password: 'long-enough-pw' })).body.token;
    const me = await call('GET', '/api/auth/me', undefined, rival);
    expect(me.body.user.business.name).toBe('Rival Stores');
    expect(me.body.user.isSuper).toBe(false);
    expect((await call('GET', '/api/businesses', undefined, rival)).status).toBe(403); // a business admin is not the owner
  });

  it('keeps people separate', async () => {
    expect((await call('POST', '/api/users', { username: 'rcash', password: 'long-enough-pw', role: 'cashier' }, rival)).status).toBe(201);
    rivalCashier = (await call('POST', '/api/auth/login', { username: 'rcash', password: 'long-enough-pw' })).body.token;
    const mine = (await call('GET', '/api/users', undefined, admin)).body.users.map((u: any) => u.username);
    const theirs = (await call('GET', '/api/users', undefined, rival)).body.users.map((u: any) => u.username);
    expect(mine).not.toContain('rcash');
    expect(theirs.sort()).toEqual(['rcash', 'rivalboss']);
    // neither business admin can touch the other's accounts
    expect((await call('POST', '/api/users/password', { username: 'amaka', password: 'hijacked-pw-1' }, rival)).status).toBe(404);
    expect((await call('POST', '/api/users/disable', { username: 'amaka', disabled: true }, rival)).status).toBe(404);
    expect((await call('POST', '/api/users/disable', { username: 'rcash', disabled: true }, manager)).status).toBe(403);
    expect((await call('POST', '/api/auth/login', { username: 'amaka', password: 'long-enough-pw' })).status).toBe(200);
  });

  it('keeps data separate, even for the same ids', async () => {
    expect((await pushAs(rival, [{ id: 1, entity: 'sale', op: 'create', at: clock, payload: { id: 'secret-sale', items: [{ productId: 'rp', qty: 1, price: 50 }], total: 50 } }])).body.accepted).toEqual([1]);
    const mineSeen = await pullAll(admin);
    expect(JSON.stringify(mineSeen)).not.toContain('secret-sale');
    const theirsSeen = await pullAll(rival);
    expect(theirsSeen.some((c) => c.payload.id === 'secret-sale')).toBe(true);
    expect(JSON.stringify(theirsSeen)).not.toContain('"p1"'); // none of the first business's sales
    // a cashier in the other business cannot void a sale that only exists in the first business
    const ownerOfMain = await pullAll(admin, 'x');
    const mainSale = ownerOfMain.find((c) => c.entity === 'sale');
    if (mainSale) {
      const v = await pushAs(rivalCashier, [{ id: 2, entity: 'sale', op: 'void', at: clock, payload: { id: mainSale.payload.id } }]);
      expect(v.body.rejected).toHaveLength(1);
    }
    // a transfer receipt in one business cannot reference a send from another
    const send = { id: 3, entity: 'transfer', op: 'create', at: clock, payload: { id: 'trx', fromLocationId: 'main', toLocationId: 'b', items: [{ productId: 'rp', qty: 2 }] } };
    expect((await pushAs(rival, [send])).body.accepted).toEqual([3]);
    const recv = { id: 4, entity: 'transfer', op: 'receive', at: clock, payload: { id: 'trx', toLocationId: 'b', items: [{ productId: 'rp', qty: 2 }] } };
    expect((await pushAs(manager, [recv], 'dev-m')).body.rejected[0].reason).toMatch(/no such transfer/);
  });
});

describe('expiry lots', () => {
  const push = (items: unknown[], token: string) => call('POST', '/api/sync', { deviceId: 'dev-lot', items }, token);
  it('managers record batches, bad ones and cashiers are refused, and cashiers still receive them', async () => {
    const good = { id: 801, entity: 'lot', op: 'create', at: clock, payload: { id: 'lotA', productId: 'p1', locationId: 'main', qty: 4, expiresAt: clock + 86_400_000, batchNo: 'B1' } };
    expect((await push([good], manager)).body.accepted).toEqual([801]);
    const bad = { id: 802, entity: 'lot', op: 'create', at: clock, payload: { id: 'lotB', productId: 'p1', locationId: 'main', qty: 0, expiresAt: 'soon' } };
    expect((await push([bad], manager)).body.rejected).toHaveLength(1);
    expect((await push([{ ...good, id: 803, payload: { ...good.payload, id: 'lotC' } }], cashier)).body.rejected).toHaveLength(1);
    const page = (await call('GET', '/api/sync?since=0&deviceId=cash-dev', undefined, cashier)).body;
    let seen = page.changes as any[];
    let cursor = page.cursor;
    let more = page.hasMore;
    while (more) {
      const n = (await call('GET', `/api/sync?since=${cursor}&deviceId=cash-dev`, undefined, cashier)).body;
      seen = seen.concat(n.changes); cursor = n.cursor; more = n.hasMore;
    }
    expect(seen.some((c) => c.entity === 'lot' && c.payload.id === 'lotA' && c.payload.batchNo === 'B1')).toBe(true);
  });
});
