// Receipt, purchase and transfer numbers. Two tills must never print the same number, so each device
// has a short code of its own in the number: INV-20261110-K7F-0003 (K7F = this device, 3rd that day).
import { uid } from './db';

export function getDeviceId(): string {
  const key = 'openpos.deviceId';
  let id: string | null = null;
  try { id = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { /* storage blocked */ }
  if (!id) {
    id = uid();
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, id); } catch { /* storage blocked */ }
  }
  return id;
}

/** 3 letters/digits taken from the device id (no look-alike characters). 32^3 = 32,768 possible codes. */
export function deviceCode(id = getDeviceId()): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
  const hex = id.replace(/[^0-9a-f]/gi, '');
  let n = parseInt(hex.slice(0, 8) || '0', 16);
  let out = '';
  for (let i = 0; i < 3; i++) { out += alphabet[n % 32]; n = Math.floor(n / 32); }
  return out;
}

export const dayStamp = (at: number): string => {
  const d = new Date(at);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

export const startOfDay = (at: number): number => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** The prefix every number made by this device today starts with, e.g. "INV-20261110-K7F-". */
export const numberPrefix = (kind: 'INV' | 'PO' | 'TR', at: number): string => `${kind}-${dayStamp(at)}-${deviceCode()}-`;

/** `madeToday` = how many numbers starting with numberPrefix() already exist. */
export const makeNumber = (kind: 'INV' | 'PO' | 'TR', at: number, madeToday: number): string =>
  `${numberPrefix(kind, at)}${String(madeToday + 1).padStart(4, '0')}`;
