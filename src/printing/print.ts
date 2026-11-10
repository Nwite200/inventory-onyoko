import type { Sale } from '../db';
import { config, formatMoney } from '../config';
import { buildSaleReceipt, buildTestPage } from './receipt';
import { savedPrinter, type Transport } from './transport';

const width = (): number => (config.printer.paperMm === 80 ? 48 : 32);

async function transport(): Promise<Transport> {
  const mode = config.printer.mode === 'browser' ? 'usb' : config.printer.mode;
  const t = await savedPrinter(mode, config.printer.baudRate);
  if (!t) throw new Error('No printer connected on this device. Open Settings > Receipt printing and tap "Connect printer".');
  return t;
}

/** Prints a sale. In browser mode it opens the normal print dialog; otherwise it sends it straight to the printer. */
export async function printSale(sale: Sale, shopName?: string): Promise<void> {
  if (config.printer.mode === 'browser') {
    window.print();
    return;
  }
  const bytes = buildSaleReceipt(sale, {
    width: width(),
    businessName: config.appName,
    address: config.printer.address,
    phone: config.printer.phone,
    footer: config.printer.footer,
    shopName,
    cut: config.printer.cut,
    openDrawer: config.printer.openDrawer,
    money: formatMoney,
    dateText: (ts) => new Date(ts).toLocaleString(config.locale),
  });
  await (await transport()).write(bytes);
}

export async function printTestPage(): Promise<void> {
  const t = await transport();
  await t.write(buildTestPage({ width: width(), businessName: config.appName, cut: config.printer.cut }));
}
