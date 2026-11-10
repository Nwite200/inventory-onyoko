import { useState } from 'react';
import type { AppConfig, PrinterSettings } from '../config';
import { bluetoothSupported, connectPrinter, isAndroid, serialSupported, usbSupported } from '../printing/transport';
import { printTestPage } from '../printing/print';
import { isSecure } from '../secure';

/** Receipt printing settings. `draft` is edited here; saving happens with the rest of Settings. */
export function PrinterSetup({ draft, onChange }: { draft: AppConfig; onChange: (p: PrinterSettings) => void }) {
  const pr = draft.printer;
  const set = <K extends keyof PrinterSettings>(k: K, v: PrinterSettings[K]) => onChange({ ...pr, [k]: v });
  const [msg, setMsg] = useState('');
  const direct = pr.mode !== 'browser';

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg('');
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'That did not work');
    }
  };

  return (
    <div className="card form">
      <h3>Receipt printing</h3>
      <label>
        Print with
        <select value={pr.mode} onChange={(e) => set('mode', e.target.value as PrinterSettings['mode'])}>
          <option value="browser">Normal print dialog (any printer, any browser)</option>
          <option value="usb">USB receipt printer, directly (Chrome/Edge)</option>
          <option value="serial">Serial / COM receipt printer, directly (Chrome/Edge on a computer)</option>
          <option value="bluetooth">Bluetooth LE receipt printer, directly (Chrome/Edge)</option>
          <option value="rawbt">Android: through the RawBT app (most Bluetooth printers)</option>
        </select>
      </label>
      <label>
        Paper width
        <select value={pr.paperMm} onChange={(e) => set('paperMm', Number(e.target.value) as 58 | 80)}>
          <option value={58}>58 mm (32 characters per line)</option>
          <option value={80}>80 mm (48 characters per line)</option>
        </select>
      </label>
      <label>Address on receipt<input value={pr.address} onChange={(e) => set('address', e.target.value)} /></label>
      <label>Phone on receipt<input value={pr.phone} onChange={(e) => set('phone', e.target.value)} /></label>
      <label>Footer message<input value={pr.footer} onChange={(e) => set('footer', e.target.value)} /></label>
      {direct && (
        <>
          {!isSecure() && <p className="error">Direct printing needs https (see the notice at the top of the page).</p>}
          {pr.mode === 'usb' && !usbSupported() && <p className="error">This browser cannot print to USB printers directly. Use Chrome or Edge, or the normal print dialog.</p>}
          {pr.mode === 'serial' && !serialSupported() && <p className="error">This browser cannot print to serial printers directly. Use Chrome or Edge on a computer, or the normal print dialog.</p>}
          {pr.mode === 'bluetooth' && !bluetoothSupported() && <p className="error">This browser cannot print to Bluetooth printers directly. On Android use the RawBT option; otherwise use the normal print dialog.</p>}
          {pr.mode === 'rawbt' && !isAndroid() && <p className="error">RawBT is an Android app. On this device use another option.</p>}
          {pr.mode === 'rawbt' && (
            <p className="small muted">Install the free "RawBT" app from Google Play, add your printer inside RawBT (Settings &gt; Add printer), and print its test page. After that, "Print receipt" here hands the receipt to RawBT. If a receipt does not print by itself after a sale, tap "Print receipt" on it.</p>
          )}
          {pr.mode === 'serial' && (
            <label>Speed (baud rate)<input type="number" value={pr.baudRate} onChange={(e) => set('baudRate', Number(e.target.value) || 9600)} /></label>
          )}
          <label className="check"><input type="checkbox" checked={pr.auto} onChange={(e) => set('auto', e.target.checked)} /> Print automatically after every sale</label>
          <label className="check"><input type="checkbox" checked={pr.cut} onChange={(e) => set('cut', e.target.checked)} /> Printer has an auto-cutter</label>
          <label className="check"><input type="checkbox" checked={pr.openDrawer} onChange={(e) => set('openDrawer', e.target.checked)} /> Open the cash drawer on cash sales</label>
          <div className="row-btns">
            {pr.mode !== 'rawbt' && <button onClick={() => void run(() => connectPrinter(pr.mode, pr.baudRate), 'Printer connected on this device.')}>Connect printer</button>}
            <button onClick={() => void run(printTestPage, 'Test page sent. Check the printer.')}>Print test page</button>
          </div>
          <p className="small muted">Tap "Save settings" first so the paper width and options are used. Printers are connected per device. Many cheap Bluetooth printers are "classic" Bluetooth, which a web page cannot reach: use the RawBT option for those.</p>
        </>
      )}
      {msg && <p className="small" role="status">{msg}</p>}
    </div>
  );
}
