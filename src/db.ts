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
  /** Optional merchandising group. Free text so a shop can start without configuring categories. */
  category?: string;
  updatedAt: number;
  /** Tax rule applied at the till. */
  taxRateId?: string;
  /** Services do not hold stock. */
  isService?: boolean;
  /** When true the catalogue expects serial numbers for this product. */
  trackSerials?: boolean;
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
  /** Value of an adjustment, used for approval thresholds. */
  value?: number;
  /** Stable key shared with an approved adjustment request. */
  approvalKey?: string;
}

export interface SaleItem {
  productId: string;
  name: string;
  qty: number;
  price: number;
  /** Cost at the moment of sale. Optional for sales recorded before this was captured. */
  cost?: number;
  /** Tax rule applied to this line. */
  taxRateId?: string;
  /** Serial numbers issued for this line (serial-tracked products). */
  serials?: string[];
  /** Bins this line was picked from, when bin picking is enforced. */
  binPicks?: { binId: string; qty: number }[];
}

export interface PaymentLine {
  method: string;
  amount: number;
  reference?: string;
}

export interface TaxLine {
  name: string;
  rate: number;
  amount: number;
}

export interface Sale {
  id: string;
  number: string;
  at: number;
  customerName: string;
  payment: string;
  items: SaleItem[];
  /** Before discount and tax. Missing on older sales, where subtotal === total. */
  subtotal?: number;
  discount?: number;
  /** Tax extracted (inclusive) or added (exclusive). */
  tax?: number;
  taxBreakdown?: TaxLine[];
  /** Split payment tenders. When absent, `payment` is the single method. */
  payments?: PaymentLine[];
  total: number;
  status: 'completed' | 'voided';
  locationId?: string;
  cashier?: string;
  note?: string;
  /** Transaction currency, if the shop sells in more than one. `total` is always in base currency. */
  currency?: string;
  fxRate?: number;
  foreignTotal?: number;
  /** Quotation/order this sale was converted from. */
  documentId?: string;
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
  /** What the shop paid per unit, in base currency. */
  cost: number;
  /** Unit cost as entered in the purchase currency, when it was foreign. */
  foreignCost?: number;
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
  /** Foreign purchase: `total`, `paid` and item costs are still base currency. */
  currency?: string;
  fxRate?: number;
  foreignTotal?: number;
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
  phone?: string;
  email?: string;
  address?: string;
  creditLimit?: number;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
}

export interface Brand {
  id: string;
  name: string;
}

export interface Expense {
  id: string;
  category: string;
  amount: number;
  paymentMethod: string;
  at: number;
  locationId?: string;
  createdBy?: string;
  note?: string;
}

export interface CashRegister {
  id: string;
  userId: string;
  locationId: string;
  openedAt: number;
  closedAt?: number;
  openingCash: number;
  closingCash?: number;
  expectedCash?: number;
  status: 'open' | 'closed';
  notes?: string;
}

export interface SaleReturnItem {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  refundAmount: number;
  condition: 'restock' | 'damaged';
  /** Cost at the time of sale, used to reverse COGS correctly. */
  cost?: number;
  /** Serial numbers returned on this line. */
  serials?: string[];
  /** Bins the returned units go back to. */
  binReturns?: { binId: string; qty: number }[];
}

export interface SaleReturn {
  id: string;
  number: string;
  saleId: string;
  saleNumber: string;
  at: number;
  customerName: string;
  items: SaleReturnItem[];
  totalRefunded: number;
  /** Tax reversed with this refund, when the original sale carried tax. */
  tax?: number;
  paymentMethod: string;
  reason?: string;
  locationId?: string;
  status: 'completed' | 'voided';
  approvalId?: string;
}

// ---------------------------------------------------------------------------------------------
// Advanced operations

export interface SaleDocumentItem {
  productId: string;
  name: string;
  qty: number;
  price: number;
  taxRateId?: string;
}

/** Quotation or sales order. Stock moves only when it is converted to a sale. */
export interface SaleDocument {
  id: string;
  number: string;
  type: 'quote' | 'order';
  at: number;
  customerName: string;
  items: SaleDocumentItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  status: 'draft' | 'sent' | 'accepted' | 'converted' | 'cancelled';
  validUntil?: number;
  note?: string;
  locationId?: string;
  saleId?: string;
}

export interface CustomerPaymentAllocation {
  saleId: string;
  amount: number;
}

export interface CustomerPayment {
  id: string;
  number: string;
  customerId?: string;
  customerName: string;
  amount: number;
  method: string;
  at: number;
  reference?: string;
  allocations: CustomerPaymentAllocation[];
  locationId?: string;
}

export interface TaxRate {
  id: string;
  name: string;
  rate: number;
  inclusive: boolean;
  accountCode: string;
  active: boolean;
}

export interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string;
  /** Base-currency units per one unit of this currency. */
  rate: number;
  updatedAt: number;
}

export interface SerialNumber {
  id: string;
  productId: string;
  productName: string;
  serial: string;
  status: 'in_stock' | 'sold' | 'returned' | 'damaged';
  locationId: string;
  batchNo?: string;
  cost?: number;
  warrantyUntil?: number;
  saleId?: string;
  at: number;
  updatedAt: number;
}

export interface WarehouseBin {
  id: string;
  locationId: string;
  code: string;
  name: string;
  zone?: string;
  aisle?: string;
  rack?: string;
  shelf?: string;
  bin?: string;
}

/** Allocation of existing stock to a physical bin. Never changes the product's total stock. */
export interface BinMovement {
  id: string;
  productId: string;
  binId: string;
  delta: number;
  reason: string;
  ref?: string;
  at: number;
  locationId: string;
}

export interface PickTaskItem {
  productId: string;
  name: string;
  qty: number;
  binId?: string;
}

export interface PickTask {
  id: string;
  number: string;
  saleId: string;
  saleNumber: string;
  items: PickTaskItem[];
  status: 'pending' | 'picked' | 'cancelled';
  at: number;
  pickedAt?: number;
  locationId: string;
}

export interface BomItem {
  productId: string;
  name: string;
  qty: number;
}

export interface Bom {
  id: string;
  productId: string;
  name: string;
  items: BomItem[];
  outputQty: number;
  laborCost: number;
  overheadCost: number;
  active: boolean;
}

export interface ProductionOrder {
  id: string;
  number: string;
  bomId: string;
  productId: string;
  name: string;
  qty: number;
  status: 'planned' | 'completed' | 'cancelled';
  at: number;
  completedAt?: number;
  componentCost: number;
  laborCost: number;
  overheadCost: number;
  unitCost: number;
  /** Exploded raw components for multi-level BOMs. */
  components?: BomItem[];
  locationId: string;
}

export interface FixedAsset {
  id: string;
  name: string;
  category: string;
  cost: number;
  acquiredAt: number;
  lifeMonths: number;
  salvage: number;
  status: 'active' | 'disposed';
  lastDepreciatedAt?: number;
  monthsPosted?: number;
}

export interface BudgetLine {
  account: string;
  amount: number;
}

export interface Budget {
  id: string;
  name: string;
  start: number;
  end: number;
  lines: BudgetLine[];
  locationId?: string;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  salary: number;
  taxRate: number;
  pensionRate: number;
  active: boolean;
  phone?: string;
  hiredAt: number;
}

export interface Payslip {
  id: string;
  number: string;
  employeeId: string;
  employeeName: string;
  periodStart: number;
  periodEnd: number;
  gross: number;
  tax: number;
  pension: number;
  net: number;
  status: 'draft' | 'paid';
  at: number;
  paidAt?: number;
}

export interface BankAccount {
  id: string;
  name: string;
  bank: string;
  number: string;
  accountCode: string;
  openingBalance: number;
}

export interface BankTransaction {
  id: string;
  bankAccountId: string;
  date: number;
  description: string;
  amount: number;
  reference?: string;
  status: 'uncleared' | 'cleared';
  matchedTo?: string;
}

export interface Approval {
  id: string;
  kind: 'refund' | 'void' | 'expense' | 'stock_adjustment' | 'journal';
  entityId: string;
  summary: string;
  amount: number;
  requestedBy: string;
  requestedAt: number;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: string;
  decidedAt?: number;
  note?: string;
}

export interface OutboxItem {
  id?: number;
  entity: string;
  op: string;
  payload: unknown;
  at: number;
}

export interface JournalLine {
  account: string;
  debit: number;
  credit: number;
  memo?: string;
}

/** A manual double-entry journal. Posted entries are immutable; corrections are reversals. */
export interface JournalEntry {
  id: string;
  number: string;
  date: number;
  memo: string;
  lines: JournalLine[];
  createdAt: number;
  createdBy?: string;
  /** Set when this entry reverses another. */
  reverses?: string;
  approvalKey?: string;
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
  categories!: Table<Category, string>;
  brands!: Table<Brand, string>;
  expenses!: Table<Expense, string>;
  registers!: Table<CashRegister, string>;
  returns!: Table<SaleReturn, string>;
  journals!: Table<JournalEntry, string>;
  saleDocuments!: Table<SaleDocument, string>;
  customerPayments!: Table<CustomerPayment, string>;
  taxRates!: Table<TaxRate, string>;
  currencies!: Table<Currency, string>;
  serials!: Table<SerialNumber, string>;
  bins!: Table<WarehouseBin, string>;
  binMovements!: Table<BinMovement, string>;
  pickTasks!: Table<PickTask, string>;
  boms!: Table<Bom, string>;
  productionOrders!: Table<ProductionOrder, string>;
  assets!: Table<FixedAsset, string>;
  budgets!: Table<Budget, string>;
  employees!: Table<Employee, string>;
  payslips!: Table<Payslip, string>;
  bankAccounts!: Table<BankAccount, string>;
  bankTransactions!: Table<BankTransaction, string>;
  approvals!: Table<Approval, string>;

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
    this.version(4).stores({
      categories: 'id, name',
      brands: 'id, name',
      expenses: 'id, category, at, locationId',
      registers: 'id, userId, status, openedAt, closedAt',
      returns: 'id, saleId, number, at',
    });
    this.version(5).stores({
      journals: 'id, number, date',
      products: 'id, name, sku, category',
    });
    this.version(6).stores({
      saleDocuments: 'id, number, type, status, at',
      customerPayments: 'id, customerId, at, number',
      taxRates: 'id, name',
      currencies: 'code',
      serials: 'id, productId, serial, status, locationId',
      bins: 'id, locationId, code',
      binMovements: 'id, productId, binId, at',
      pickTasks: 'id, status, saleId, at',
      boms: 'id, productId',
      productionOrders: 'id, number, status, at',
      assets: 'id, status',
      budgets: 'id, name, start',
      employees: 'id, name, active',
      payslips: 'id, employeeId, periodStart, status',
      bankAccounts: 'id, name',
      bankTransactions: 'id, bankAccountId, date, status',
      approvals: 'id, kind, status, requestedAt',
    });
    this.version(7).stores({
      serials: 'id, productId, serial, status, locationId, at',
      payslips: 'id, employeeId, periodStart, status, at',
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
