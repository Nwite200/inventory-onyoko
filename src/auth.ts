import { config } from './config';
import type { Role } from './voice/agent';
import { purgeForCashier, wipeLocalData } from './syncApply';

export interface Session {
  token: string;
  username: string;
  role: Role;
  serverUrl: string;
  businessId?: string;
  businessName?: string;
  /** the platform owner: may open other businesses on this server */
  isSuper?: boolean;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const KEY = 'openpos.session';
export const AUTH_EVENT = 'openpos-auth';

export const serverBase = (): string => config.serverUrl.trim().replace(/\/+$/, '');
export const serverMode = (): boolean => serverBase() !== '';

export function getSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Session | null;
    // a session only counts for the server it was created on
    return s && s.serverUrl === serverBase() ? s : null;
  } catch {
    return null;
  }
}

function setSession(s: Session | null): void {
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(AUTH_EVENT));
}

export function logout(): void {
  setSession(null);
}

export async function api<T>(method: 'GET' | 'POST', path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(serverBase() + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, `Cannot reach the server at ${serverBase()}. Check the address and your connection.`);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Server replied ${res.status}`);
  return data as T;
}

export async function authStatus(): Promise<{ needsSetup: boolean }> {
  return api('GET', '/api/auth/status');
}

interface LoginReply {
  token: string;
  user: { username: string; role: Role; isSuper?: boolean; business?: { id: string; name: string } };
}

async function finish(r: LoginReply): Promise<Session> {
  const s: Session = {
    token: r.token,
    username: r.user.username,
    role: r.user.role,
    serverUrl: serverBase(),
    businessId: r.user.business?.id,
    businessName: r.user.business?.name,
    isSuper: r.user.isSuper === true,
  };
  // a different business on the same device must never see the first one's data
  const bizKey = `openpos.business.${serverBase()}`;
  const before = localStorage.getItem(bizKey);
  if (s.businessId && before !== null && before !== s.businessId) {
    await wipeLocalData();
    localStorage.removeItem(`openpos.cursor.${serverBase()}`);
    localStorage.removeItem(`openpos.feed.${serverBase()}`);
  }
  if (s.businessId) localStorage.setItem(bizKey, s.businessId);
  if (s.role === 'cashier') await purgeForCashier();
  setSession(s);
  return s;
}

export async function login(username: string, password: string): Promise<Session> {
  return finish(await api<LoginReply>('POST', '/api/auth/login', { username, password }));
}

export async function setupAdmin(username: string, password: string): Promise<Session> {
  return finish(await api<LoginReply>('POST', '/api/auth/setup', { username, password }));
}

/** Changes the signed-in user's password. The server ends every other session; this device gets a fresh one. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const s = getSession();
  if (!s) throw new ApiError(401, 'Please sign in');
  await finish(await api<LoginReply>('POST', '/api/auth/password', { currentPassword, newPassword }, s.token));
}
