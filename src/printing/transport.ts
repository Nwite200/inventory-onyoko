// Sending bytes to a printer. Two ways a browser can talk to a printer directly:
//  - WebUSB:    USB receipt printers (Chrome/Edge on Windows, Mac, Linux, Android). Needs https.
//  - Web Serial: printers that appear as a serial/COM port (USB-serial, some Bluetooth-serial). Chrome/Edge desktop. Needs https.
//  - Web Bluetooth: printers that speak Bluetooth LE (BLE) only. Chrome/Edge (Android and computers). Needs https.
//    Most cheap 58mm printers are "classic" Bluetooth, which web pages cannot reach at all; for those, use...
//  - RawBT:     a free Android app that holds the Bluetooth connection. The page hands the receipt to it
//    (rawbt: link, documented at rawbt.ru). Works in Chrome on Android with any printer RawBT supports.
// None of these exist in Firefox or Safari (iPhone). There the "Browser print" mode (the normal print dialog) is the way.
// NOTE: only the encoding is tested automatically; the USB/serial code below has been checked against mocks
// but not against a real printer, because none was available while building it.

export type Mode = 'browser' | 'usb' | 'serial' | 'bluetooth' | 'rawbt';

export interface Transport {
  write(data: Uint8Array): Promise<void>;
  label: string;
}

// minimal shapes of the browser APIs (TypeScript's DOM library does not include them)
interface UsbEndpoint { endpointNumber: number; direction: 'in' | 'out'; type: string }
interface UsbDevice {
  vendorId: number; productId: number; productName?: string; opened: boolean;
  configuration: { interfaces: { interfaceNumber: number; alternates: { interfaceClass: number; endpoints: UsbEndpoint[] }[] }[] } | null;
  open(): Promise<void>; selectConfiguration(n: number): Promise<void>; claimInterface(n: number): Promise<void>;
  transferOut(ep: number, data: BufferSource): Promise<{ status: string }>;
}
interface UsbApi { requestDevice(o: { filters: unknown[] }): Promise<UsbDevice>; getDevices(): Promise<UsbDevice[]> }
interface SerialPortLike {
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  open(o: { baudRate: number }): Promise<void>;
  writable: { getWriter(): { write(d: Uint8Array): Promise<void>; releaseLock(): void } } | null;
}
interface SerialApi { requestPort(): Promise<SerialPortLike>; getPorts(): Promise<SerialPortLike[]> }

interface BleCharacteristic {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValueWithResponse?(d: BufferSource): Promise<void>;
  writeValueWithoutResponse?(d: BufferSource): Promise<void>;
  writeValue(d: BufferSource): Promise<void>;
}
interface BleService { getCharacteristics(): Promise<BleCharacteristic[]> }
interface BleDevice {
  id: string; name?: string;
  gatt?: { connected: boolean; connect(): Promise<{ getPrimaryServices(): Promise<BleService[]> }> };
}
interface BluetoothApi { requestDevice(o: { acceptAllDevices: boolean; optionalServices: string[] }): Promise<BleDevice>; getDevices?(): Promise<BleDevice[]> }

const nav = (): { usb?: UsbApi; serial?: SerialApi; bluetooth?: BluetoothApi } =>
  typeof navigator === 'undefined' ? {} : (navigator as unknown as { usb?: UsbApi; serial?: SerialApi; bluetooth?: BluetoothApi });
export const usbSupported = (): boolean => !!nav().usb;
export const serialSupported = (): boolean => !!nav().serial;
export const bluetoothSupported = (): boolean => !!nav().bluetooth;
export const isAndroid = (): boolean => typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

/** Services that common BLE receipt printers use for printing. A printer using another one will not be found. */
export const BLE_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];

const SAVED = 'openpos.printer';
const saveId = (mode: Mode, v: number | undefined, p: number | undefined): void => {
  try { localStorage.setItem(SAVED, JSON.stringify({ mode, v, p })); } catch { /* storage unavailable */ }
};
const savedId = (mode: Mode): { v?: number; p?: number } | null => {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED) ?? 'null') as { mode: Mode; v?: number; p?: number } | null;
    return s && s.mode === mode ? s : null;
  } catch { return null; }
};

const CHUNK = 4096;

async function usbTransport(dev: UsbDevice): Promise<Transport> {
  if (!dev.opened) await dev.open();
  if (!dev.configuration) await dev.selectConfiguration(1);
  // find the interface with a bulk OUT endpoint, preferring the printer class (7)
  const candidates = (dev.configuration?.interfaces ?? []).flatMap((i) =>
    i.alternates.flatMap((a) => a.endpoints.filter((e) => e.direction === 'out' && e.type === 'bulk').map((e) => ({ n: i.interfaceNumber, ep: e.endpointNumber, cls: a.interfaceClass }))),
  );
  const pick = candidates.find((c) => c.cls === 7) ?? candidates[0];
  if (!pick) throw new Error('This USB device has no way to receive print data. Is it really a receipt printer?');
  await dev.claimInterface(pick.n);
  return {
    label: dev.productName || 'USB printer',
    async write(data) {
      for (let i = 0; i < data.length; i += CHUNK) {
        const r = await dev.transferOut(pick.ep, data.slice(i, i + CHUNK));
        if (r.status !== 'ok') throw new Error('The printer did not accept the data (is it on and has paper?).');
      }
    },
  };
}

async function serialTransport(port: SerialPortLike, baudRate: number): Promise<Transport> {
  try {
    await port.open({ baudRate });
  } catch (e) {
    // already open from an earlier print is fine
    if (!(e instanceof Error && /already open/i.test(e.message))) throw e;
  }
  return {
    label: 'Serial printer',
    async write(data) {
      if (!port.writable) throw new Error('The serial port is not writable.');
      const w = port.writable.getWriter();
      try {
        for (let i = 0; i < data.length; i += CHUNK) await w.write(data.slice(i, i + CHUNK));
      } finally {
        w.releaseLock();
      }
    },
  };
}

// Bluetooth LE moves small packets; 20 bytes is what every printer accepts, bigger ones are the risky part.
const BLE_CHUNK = 20;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bleTransport(dev: BleDevice): Promise<Transport> {
  const find = async (): Promise<BleCharacteristic> => {
    if (!dev.gatt) throw new Error('This Bluetooth device cannot be connected to.');
    const server = await dev.gatt.connect();
    for (const s of await server.getPrimaryServices()) {
      for (const c of await s.getCharacteristics()) if (c.properties.write || c.properties.writeWithoutResponse) return c;
    }
    throw new Error('This Bluetooth device has no way to receive print data. If it is a classic-Bluetooth printer, use the RawBT option instead.');
  };
  let ch = await find();
  return {
    label: dev.name || 'Bluetooth printer',
    async write(data) {
      if (!dev.gatt?.connected) ch = await find(); // the printer went to sleep: reconnect
      for (let i = 0; i < data.length; i += BLE_CHUNK) {
        const part = data.slice(i, i + BLE_CHUNK);
        if (ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(part);
        else if (ch.writeValueWithResponse) await ch.writeValueWithResponse(part);
        else await ch.writeValue(part);
        await pause(8); // small printers drop data that arrives too fast
      }
    },
  };
}

/** Builds the link that hands a receipt to the RawBT app on Android. Exported so it can be checked. */
export function rawbtUrl(data: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return `intent:base64,${btoa(bin)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}

const rawbtTransport: Transport = {
  label: 'RawBT app',
  async write(data) {
    if (!isAndroid()) throw new Error('RawBT only exists on Android phones and tablets.');
    // If RawBT is not installed, Android offers to install it. Needs a tap on the page shortly before.
    window.location.href = rawbtUrl(data);
  },
};

let current: { mode: Mode; t: Transport } | null = null;

/** Asks the user to pick a printer (must be called from a button tap) and remembers the choice. */
export async function connectPrinter(mode: Mode, baudRate = 9600): Promise<Transport> {
  if (mode === 'usb') {
    const usb = nav().usb;
    if (!usb) throw new Error('This browser cannot talk to USB printers. Use Chrome or Edge, or choose "Browser print".');
    const dev = await usb.requestDevice({ filters: [] });
    saveId('usb', dev.vendorId, dev.productId);
    return (current = { mode, t: await usbTransport(dev) }).t;
  }
  if (mode === 'serial') {
    const serial = nav().serial;
    if (!serial) throw new Error('This browser cannot talk to serial printers. Use Chrome or Edge on a computer, or choose "Browser print".');
    const port = await serial.requestPort();
    const i = port.getInfo();
    saveId('serial', i.usbVendorId, i.usbProductId);
    return (current = { mode, t: await serialTransport(port, baudRate) }).t;
  }
  if (mode === 'bluetooth') {
    const bt = nav().bluetooth;
    if (!bt) throw new Error('This browser cannot talk to Bluetooth printers. Use Chrome or Edge, the RawBT option on Android, or "Browser print".');
    const dev = await bt.requestDevice({ acceptAllDevices: true, optionalServices: BLE_PRINTER_SERVICES });
    saveId('bluetooth', undefined, undefined);
    const t = await bleTransport(dev);
    current = { mode, t };
    return t;
  }
  if (mode === 'rawbt') return rawbtTransport;
  throw new Error('Nothing to connect in browser print mode.');
}

/** Reuses a printer the user already allowed earlier (no prompt, so it works right after a sale). */
export async function savedPrinter(mode: Mode, baudRate = 9600): Promise<Transport | null> {
  if (mode === 'rawbt') return rawbtTransport;
  if (current?.mode === mode) return current.t; // connected earlier in this page's life
  const id = savedId(mode);
  if (mode === 'bluetooth' && nav().bluetooth?.getDevices) {
    const dev = (await nav().bluetooth!.getDevices!())[0];
    return dev ? bleTransport(dev) : null;
  }
  if (mode === 'usb' && nav().usb) {
    const devs = await nav().usb!.getDevices();
    const dev = devs.find((d) => !id || (d.vendorId === id.v && d.productId === id.p));
    return dev ? usbTransport(dev) : null;
  }
  if (mode === 'serial' && nav().serial) {
    const ports = await nav().serial!.getPorts();
    const port = ports.find((p) => !id || (p.getInfo().usbVendorId === id.v && p.getInfo().usbProductId === id.p));
    return port ? serialTransport(port, baudRate) : null;
  }
  return null;
}
