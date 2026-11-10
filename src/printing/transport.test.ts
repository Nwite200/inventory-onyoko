import { describe, expect, it, vi } from 'vitest';

// Bluetooth LE and RawBT, against simulated devices (no real printer was available).
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });

const bleDevice = (opts: { writable?: boolean; withoutResponse?: boolean } = {}) => {
  const writes: number[] = [];
  const chr = {
    properties: { write: opts.writable !== false && !opts.withoutResponse, writeWithoutResponse: !!opts.withoutResponse },
    writeValueWithResponse: vi.fn(async (d: Uint8Array) => void writes.push(d.length)),
    writeValueWithoutResponse: vi.fn(async (d: Uint8Array) => void writes.push(d.length)),
    writeValue: vi.fn(async () => undefined),
  };
  const readOnly = { properties: { write: false, writeWithoutResponse: false } };
  const dev = {
    id: 'b1', name: 'MPT-II',
    gatt: {
      connected: true,
      connect: vi.fn(async () => ({ getPrimaryServices: async () => [{ getCharacteristics: async () => (opts.writable === false ? [readOnly] : [readOnly, chr]) }] })),
    },
  };
  return { dev, chr, writes };
};

describe('Bluetooth LE printer', () => {
  it('asks for the known printer services, finds the writable characteristic and sends 20-byte packets', async () => {
    const { dev, chr, writes } = bleDevice({ withoutResponse: true });
    const requestDevice = vi.fn(async () => dev);
    vi.stubGlobal('navigator', { bluetooth: { requestDevice } });
    const { connectPrinter, BLE_PRINTER_SERVICES } = await import('./transport');
    const t = await connectPrinter('bluetooth');
    expect(requestDevice).toHaveBeenCalledWith({ acceptAllDevices: true, optionalServices: BLE_PRINTER_SERVICES });
    expect(t.label).toBe('MPT-II');
    await t.write(new Uint8Array(65));
    expect(writes).toEqual([20, 20, 20, 5]);
    expect(chr.writeValueWithoutResponse).toHaveBeenCalledTimes(4);
  });

  it('uses a write-with-response characteristic when that is all the printer offers', async () => {
    const { dev, chr } = bleDevice();
    vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => dev } });
    const { connectPrinter } = await import('./transport');
    await (await connectPrinter('bluetooth')).write(new Uint8Array(30));
    expect(chr.writeValueWithResponse).toHaveBeenCalledTimes(2);
  });

  it('reconnects when the printer went to sleep between receipts', async () => {
    const { dev } = bleDevice({ withoutResponse: true });
    vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => dev } });
    const { connectPrinter } = await import('./transport');
    const t = await connectPrinter('bluetooth');
    dev.gatt.connected = false;
    await t.write(new Uint8Array(3));
    expect(dev.gatt.connect).toHaveBeenCalledTimes(2);
  });

  it('points a classic-Bluetooth printer at RawBT instead of failing silently', async () => {
    const { dev } = bleDevice({ writable: false });
    vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => dev } });
    const { connectPrinter } = await import('./transport');
    await expect(connectPrinter('bluetooth')).rejects.toThrow(/RawBT/);
  });

  it('is reused for the next sale without asking again (same page session)', async () => {
    const { dev } = bleDevice({ withoutResponse: true });
    vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => dev } });
    const { connectPrinter, savedPrinter } = await import('./transport');
    const t = await connectPrinter('bluetooth');
    expect(await savedPrinter('bluetooth')).toBe(t);
  });
});

describe('RawBT hand-off (Android)', () => {
  it('builds an intent link whose payload is exactly the receipt bytes', async () => {
    const { rawbtUrl } = await import('./transport');
    const bytes = Uint8Array.from([0x1b, 0x40, 0x48, 0x69, 0x0a, 0xff, 0x00, 0x1d, 0x56, 0x42, 0x03]); // includes bytes >= 0x80
    const url = rawbtUrl(bytes);
    const m = /^intent:base64,([^#]+)#Intent;scheme=rawbt;package=ru\.a402d\.rawbtprinter;end;$/.exec(url)!;
    expect(m).toBeTruthy();
    expect([...Buffer.from(decodeURIComponent(m[1]!), 'base64')]).toEqual([...bytes]);
  });

  it('handles a long receipt without blowing the call stack', async () => {
    const { rawbtUrl } = await import('./transport');
    const big = new Uint8Array(200_000).map((_, i) => i % 251);
    const m = /base64,([^#]+)#/.exec(rawbtUrl(big))!;
    expect(Buffer.from(m[1]!, 'base64').length).toBe(200_000);
  });

  it('navigates to the link on Android, and says plainly it is Android-only elsewhere', async () => {
    const loc = { href: '' };
    vi.stubGlobal('window', { location: loc });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/120' });
    const { savedPrinter, connectPrinter } = await import('./transport');
    const t = (await savedPrinter('rawbt'))!;
    expect(t.label).toBe('RawBT app');
    await t.write(Uint8Array.from([0x1b, 0x40]));
    expect(loc.href).toMatch(/^intent:base64,G0A=#Intent;scheme=rawbt;package=ru\.a402d\.rawbtprinter;end;$/);
    expect(await connectPrinter('rawbt')).toBe(t); // nothing to pair: RawBT holds the connection

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' });
    await expect(t.write(new Uint8Array(1))).rejects.toThrow(/only exists on Android/);
  });
});
