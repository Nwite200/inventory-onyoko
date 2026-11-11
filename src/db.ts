import Dexie, { type Table } from 'dexie';

export interface Product {
  id: string;
  name: string;
  sku: string;
  aliases: string[];
  price: number;
  cost: number;
  unit: string;
  stock: number;
  lowStockAt: number;
  updatedAt: number;
  /** When the price was last changed; used for last-write-wins between devices. */
  priceAt?: number;
  /** When the cost was last set (by a purchase); latest wins between devices. */
  costAt?: number;
  /** When the barcode was last set; latest wins between devices. */
  skuAt?: number;
}

export interface StockMovement {
  id: string;
  productId: string;
  delta: number;
  reason: string; // opening | sale | void | purchase | purchase_void | transfer_out | transfer_in | adjustment | voice
  ref?: string;
  at: number;
  /** Which shop this stock belongs to. Missing = 'main' (older data). */
  locationId?: string;
}

export interface SaleItem {
  productId: string;
  name: string;
  qty: number;
  price: number;
}

export interface Sale {
  id: string;
  number: string;
  at: number;
  customerName: string;
  payment: string;
  items: SaleItem[];
  total: number;
  status: 'completed' | 'voided';
  locationId?: string;
}

export interface Location {
  id: string;
  name: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
}

/** A batch of a product with an expiry date. Remaining quantity per lot is worked out from stock (see lots.ts). */
export interface Lot {
  id: string;
  productId: string;
  locationId: string;
  qty: number;
  batchNo?: string;
  /** end of the expiry day, in ms */
  expiresAt: number;
  /** the purchase that brought it in, if any */
  ref?: string;
}

export interface PurchaseItem {
  productId: string;
  name: string;
  qty: number;
  /** What the shop paid per unit. */
  cost: number;
  batchNo?: string;
  /** expiry day, if the goods have one */
  expiresAt?: number;
}

export interface Payment {
  id: string;
  amount: number;
  at: number;
}

export interface Purchase {
  id: string;
  number: string;
  at: number;
  supplierId: string;
  supplierName: string;
  items: PurchaseItem[];
  total: number;
  /** Paid so far (at receipt + later payments). Owed = total - paid. */
  paid: number;
  payments: Payment[];
  status: 'received' | 'voided';
  locationId: string;
  note?: string;
}

export interface TransferItem {
  productId: string;
  name: string;
  qty: number;
}

export interface Transfer {
  id: string;
  number: string;
  fromLocationId: string;
  toLocationId: string;
  items: TransferItem[];
  status: 'sent' | 'received';
  sentAt: number;
  receivedAt?: number;
  note?: string;
}

export interface Customer {
  id: string;
  name: string;
}

export interface OutboxItem {
  id?: number;
  entity: string;
  op: string;
  payload: unknown;
  at: number;
}

export interface AuditEntry {
  id?: number;
  at: number;
  source: 'voice' | 'text' | 'ui';
  transcript?: string;
  intent: string;
  result: string;
  role: string;
}

class PosDB extends Dexie {
  products!: Table<Product, string>;
  stockMovements!: Table<StockMovement, string>;
  sales!: Table<Sale, string>;
  customers!: Table<Customer, string>;
  outbox!: Table<OutboxItem, number>;
  audit!: Table<AuditEntry, number>;
  locations!: Table<Location, string>;
  suppliers!: Table<Supplier, string>;
  purchases!: Table<Purchase, string>;
  transfers!: Table<Transfer, string>;
  lots!: Table<Lot, string>;

  constructor(name = 'openpos') {
    super(name);
    this.version(1).stores({
      products: 'id, name, sku',
      stockMovements: 'id, productId, at',
      sales: 'id, at, number',
      customers: 'id, name',
      outbox: '++id, at',
      audit: '++id, at',
    });
    this.version(2).stores({
      locations: 'id',
      suppliers: 'id, name',
      purchases: 'id, at, supplierId',
      transfers: 'id, status, sentAt',
    });
    this.version(3).stores({
      lots: 'id, productId, expiresAt, ref',
    });
  }
}

export const db = new PosDB();

/**
 * A random id. crypto.randomUUID only exists on https pages and Safari 15.4+, but getRandomValues works
 * everywhere, so a shop reached over plain http (or an older iPhone) can still sell.
 */
export const uid = (): string => {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
