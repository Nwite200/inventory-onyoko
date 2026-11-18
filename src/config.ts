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

export interface BrandingSettings {
  businessName: string;
  logo: string;
  loginLogo: string;
  favicon: string;
  secondaryColor: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  footer: string;
  invoiceTerms: string;
  receiptTemplate: 'classic' | 'compact' | 'modern';
  showLogo: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showTax: boolean;
  showQr: boolean;
  qrText: string;
}

export interface NavigationSettings {
  hidden: string[];
  order: string[];
}

export interface AppConfig {
  appName: string;
  tagline: string;
  primaryColor: string;
  currencySymbol: string;
  locale: string;
  speechLang: string;
  /** screen language: en, ha (Hausa), yo (Yoruba), ig (Igbo), pcm (Pidgin) */
  language: string;
  /** auto = browser recognition when online, on-device when offline */
  speechEngine: 'auto' | 'browser' | 'offline';
  preset: 'retail' | 'restaurant' | 'pharmacy' | 'custom';
  allowNegativeStock: boolean;
  /** Amount above which refunds and voids need an approved request. 0 disables approvals. */
  approvalThreshold: number;
  serverUrl: string;
  features: Features;
  llm: LlmSettings;
  printer: PrinterSettings;
  branding: BrandingSettings;
  navigation: NavigationSettings;
}

export const defaultConfig: AppConfig = {
  appName: 'OpenPOS',
  tagline: 'Sell and manage stock, even offline',
  primaryColor: '#4f46e5',
  currencySymbol: '₦',
  locale: 'en-NG',
  speechLang: 'en-NG',
  language: 'en',
  speechEngine: 'auto',
  preset: 'retail',
  allowNegativeStock: false,
  approvalThreshold: 0,
  serverUrl: '',
  features: { voice: true, customers: true, reports: true, sales: true, purchases: true, transfers: true },
  printer: { mode: 'browser', paperMm: 58, baudRate: 9600, auto: false, cut: true, openDrawer: false, address: '', phone: '', footer: 'Thank you!' },
  branding: {
    businessName: 'My business',
    logo: '',
    loginLogo: '',
    favicon: '',
    secondaryColor: '#0ea5e9',
    address: '',
    phone: '',
    email: '',
    website: '',
    footer: 'Thank you for your business',
    invoiceTerms: 'Payment due on receipt',
    receiptTemplate: 'classic',
    showLogo: true,
    showAddress: true,
    showPhone: true,
    showTax: true,
    showQr: false,
    qrText: '',
  },
  navigation: { hidden: [], order: [] },
  llm: {
    provider: 'none',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.2',
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
  const branding = { ...config.branding, ...(patch.branding ?? {}) };
  const navigation = { ...config.navigation, ...(patch.navigation ?? {}) };
  Object.assign(config, patch, { features, llm, printer, branding, navigation });
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
  document.documentElement.style.setProperty('--secondary', config.branding.secondaryColor);
  document.documentElement.style.setProperty('--paper', `${config.printer.paperMm}mm`);
  document.title = config.appName;
  if (config.branding.favicon) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = config.branding.favicon;
  } else {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = '/icon.svg';
  }
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
