// White-label configuration.
// Precedence (low -> high): built-in defaults < /config.json (per deployment) < settings saved on this device.

export interface Features {
  voice: boolean;
  customers: boolean;
  reports: boolean;
  sales: boolean;
  purchases: boolean;
  transfers: boolean;
}

export interface LlmSettings {
  provider: 'none' | 'ollama' | 'gemini';
  ollamaUrl: string;
  ollamaModel: string;
  geminiKey: string;
  geminiModel: string;
}

export interface PrinterSettings {
  /** browser = the normal print dialog; usb / serial = straight to a receipt printer */
  mode: 'browser' | 'usb' | 'serial' | 'bluetooth' | 'rawbt';
  paperMm: 58 | 80;
  baudRate: number;
  /** print a receipt automatically after every sale (usb/serial only) */
  auto: boolean;
  cut: boolean;
  openDrawer: boolean;
  address: string;
  phone: string;
  footer: string;
}

export interface AppConfig {
  appName: string;
  tagline: string;
  primaryColor: string;
  currencySymbol: string;
  locale: string;
  speechLang: string;
  /** auto = browser recognition when online, on-device when offline */
  speechEngine: 'auto' | 'browser' | 'offline';
  preset: 'retail' | 'restaurant' | 'pharmacy' | 'custom';
  allowNegativeStock: boolean;
  serverUrl: string;
  features: Features;
  llm: LlmSettings;
  printer: PrinterSettings;
}

export const defaultConfig: AppConfig = {
  appName: 'OpenPOS',
  tagline: 'Sell and manage stock, even offline',
  primaryColor: '#0f766e',
  currencySymbol: '₦',
  locale: 'en-NG',
  speechLang: 'en-NG',
  speechEngine: 'auto',
  preset: 'retail',
  allowNegativeStock: false,
  serverUrl: '',
  features: { voice: true, customers: true, reports: true, sales: true, purchases: true, transfers: true },
  printer: { mode: 'browser', paperMm: 58, baudRate: 9600, auto: false, cut: true, openDrawer: false, address: '', phone: '', footer: 'Thank you!' },
  llm: {
    provider: 'none',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.2',
    geminiKey: '',
    geminiModel: 'gemini-2.0-flash',
  },
};

export const presets: Record<'retail' | 'restaurant' | 'pharmacy', Partial<AppConfig>> = {
  retail: { preset: 'retail', features: { voice: true, customers: true, reports: true, sales: true, purchases: true, transfers: true } },
  restaurant: { preset: 'restaurant', features: { voice: true, customers: false, reports: true, sales: true, purchases: true, transfers: false } },
  pharmacy: { preset: 'pharmacy', allowNegativeStock: false, features: { voice: true, customers: true, reports: true, sales: true, purchases: true, transfers: true } },
};

// Mutable singleton so every module sees the live config.
/** Deep copy of plain data. (structuredClone is missing in Safari before 15.4 and Firefox before 94.) */
export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export const config: AppConfig = clone(defaultConfig);

const LS_KEY = 'openpos.config';

export function applyConfig(patch: Partial<AppConfig>): void {
  const features = { ...config.features, ...(patch.features ?? {}) };
  const llm = { ...config.llm, ...(patch.llm ?? {}) };
  const printer = { ...config.printer, ...(patch.printer ?? {}) };
  Object.assign(config, patch, { features, llm, printer });
}

export function saveConfig(patch: Partial<AppConfig>): void {
  applyConfig(patch);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LS_KEY, JSON.stringify(config));
  }
  applyTheme();
}

export function applyTheme(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--primary', config.primaryColor);
  document.documentElement.style.setProperty('--paper', `${config.printer.paperMm}mm`);
  document.title = config.appName;
}

export async function initConfig(): Promise<void> {
  try {
    const res = await fetch('/config.json', { cache: 'no-cache' });
    if (res.ok) applyConfig(await res.json());
  } catch {
    /* offline: fall back to defaults + local settings */
  }
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
    if (raw) applyConfig(JSON.parse(raw));
  } catch {
    /* ignore corrupted local settings */
  }
  applyTheme();
}

export function formatMoney(n: number): string {
  return config.currencySymbol + n.toLocaleString(config.locale, { maximumFractionDigits: 2 });
}
