// Finance operations that sit on top of the ledger: fixed assets, budgets, payroll,
// currencies and simple bank reconciliation.
import { db, uid, type BankAccount, type BankTransaction, type Budget, type Currency, type Employee, type FixedAsset, type Payslip } from './db';
import { queueAdvanced } from './advanced';
import { accountBalances, accountName, postJournal, type LedgerEntry } from './accounting';
import { getSession } from './auth';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const MONTH = 30.44 * 86_400_000;

// ---------------------------------------------------------------------------------------------
// Fixed assets

export function monthlyDepreciation(asset: FixedAsset): number {
  if (!(asset.lifeMonths > 0)) return 0;
  return round2(Math.max(0, asset.cost - asset.salvage) / asset.lifeMonths);
}

export function accumulatedDepreciation(asset: FixedAsset): number {
  const posted = asset.monthsPosted ?? 0;
  return round2(Math.min(Math.max(0, asset.cost - asset.salvage), monthlyDepreciation(asset) * posted));
}

export async function addAsset(input: { name: string; category: string; cost: number; acquiredAt?: number; lifeMonths: number; salvage?: number }): Promise<FixedAsset> {
  if (!input.name.trim()) throw new Error('Asset name is required');
  if (!(input.cost > 0)) throw new Error('Cost must be more than zero');
  if (!(input.lifeMonths > 0)) throw new Error('Useful life must be at least one month');
  const salvage = Math.max(0, input.salvage ?? 0);
  if (salvage >= input.cost) throw new Error('Salvage value must be less than cost');
  const asset: FixedAsset = {
    id: uid(),
    name: input.name.trim(),
    category: input.category.trim() || 'Equipment',
    cost: round2(input.cost),
    acquiredAt: input.acquiredAt ?? Date.now(),
    lifeMonths: Math.floor(input.lifeMonths),
    salvage: round2(salvage),
    status: 'active',
    monthsPosted: 0,
  };
  await db.transaction('rw', [db.assets, db.outbox], async () => {
    await db.assets.add(asset);
    await queueAdvanced('assets', asset);
  });
  return asset;
}

/** Posts one month of straight-line depreciation as an immutable journal. */
export async function postDepreciation(assetId: string): Promise<number> {
  const asset = await db.assets.get(assetId);
  if (!asset) throw new Error('Asset not found');
  if (asset.status !== 'active') throw new Error('This asset is no longer active');
  if ((asset.monthsPosted ?? 0) >= asset.lifeMonths) throw new Error('This asset is fully depreciated');
  const amount = monthlyDepreciation(asset);
  if (!(amount > 0)) throw new Error('Nothing to depreciate');
  await postJournal({
    memo: `Depreciation — ${asset.name}`,
    lines: [
      { account: '7100', debit: amount, credit: 0 },
      { account: '1510', debit: 0, credit: amount },
    ],
    createdBy: getSession()?.username ?? 'local',
  });
  const next: FixedAsset = {
    ...asset,
    monthsPosted: (asset.monthsPosted ?? 0) + 1,
    lastDepreciatedAt: Date.now(),
  };
  await db.transaction('rw', [db.assets, db.outbox], async () => {
    await db.assets.put(next);
    await queueAdvanced('assets', next);
  });
  return amount;
}

// ---------------------------------------------------------------------------------------------
// Budgets

export async function saveBudget(input: { name: string; start: number; end: number; lines: { account: string; amount: number }[] }): Promise<Budget> {
  if (!input.name.trim()) throw new Error('Budget name is required');
  if (!(input.end > input.start)) throw new Error('The budget end must be after its start');
  const lines = input.lines.filter((l) => l.account && l.amount >= 0).map((l) => ({ account: l.account, amount: round2(l.amount) }));
  if (lines.length === 0) throw new Error('Add at least one account line');
  const record: Budget = { id: uid(), name: input.name.trim(), start: input.start, end: input.end, lines };
  await db.transaction('rw', [db.budgets, db.outbox], async () => {
    await db.budgets.add(record);
    await queueAdvanced('budgets', record);
  });
  return record;
}

export interface BudgetVarianceRow {
  account: string;
  name: string;
  budget: number;
  actual: number;
  variance: number;
}

export function budgetVariance(budget: Budget, entries: LedgerEntry[]): { rows: BudgetVarianceRow[]; totalBudget: number; totalActual: number; totalVariance: number } {
  const balances = new Map(accountBalances(entries, budget.start, budget.end).map((r) => [r.code, r.balance]));
  const rows = budget.lines.map((l) => {
    const actual = round2(balances.get(l.account) ?? 0);
    return { account: l.account, name: accountName(l.account), budget: l.amount, actual, variance: round2(l.amount - actual) };
  });
  const totalBudget = round2(rows.reduce((s, r) => s + r.budget, 0));
  const totalActual = round2(rows.reduce((s, r) => s + r.actual, 0));
  return { rows, totalBudget, totalActual, totalVariance: round2(totalBudget - totalActual) };
}

// ---------------------------------------------------------------------------------------------
// Payroll

export async function addEmployee(input: { name: string; role: string; salary: number; taxRate?: number; pensionRate?: number; phone?: string }): Promise<Employee> {
  if (!input.name.trim()) throw new Error('Employee name is required');
  if (!(input.salary > 0)) throw new Error('Salary must be more than zero');
  const employee: Employee = {
    id: uid(),
    name: input.name.trim(),
    role: input.role.trim() || 'Staff',
    salary: round2(input.salary),
    taxRate: Math.min(100, Math.max(0, input.taxRate ?? 7.5)),
    pensionRate: Math.min(100, Math.max(0, input.pensionRate ?? 8)),
    active: true,
    hiredAt: Date.now(),
    ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
  };
  await db.transaction('rw', [db.employees, db.outbox], async () => {
    await db.employees.add(employee);
    await queueAdvanced('employees', employee);
  });
  return employee;
}

export function payrollFigures(employee: { salary: number; taxRate: number; pensionRate: number }): { gross: number; tax: number; pension: number; net: number } {
  const gross = round2(employee.salary);
  const tax = round2((gross * employee.taxRate) / 100);
  const pension = round2((gross * employee.pensionRate) / 100);
  return { gross, tax, pension, net: round2(gross - tax - pension) };
}

/** Creates draft payslips for the period, skipping anyone who already has one. */
export async function runPayroll(periodStart: number, periodEnd: number): Promise<Payslip[]> {
  if (!(periodEnd > periodStart)) throw new Error('The pay period is invalid');
  const employees = (await db.employees.toArray()).filter((e) => e.active);
  if (employees.length === 0) throw new Error('Add an employee first');
  const existing = await db.payslips.toArray();
  const created: Payslip[] = [];
  for (const employee of employees) {
    if (existing.some((p) => p.employeeId === employee.id && p.periodStart === periodStart && p.status !== 'draft')) continue;
    if (existing.some((p) => p.employeeId === employee.id && p.periodStart === periodStart)) continue;
    const figures = payrollFigures(employee);
    created.push({
      id: uid(),
      number: `PS-${new Date(periodEnd).getFullYear()}${String(new Date(periodEnd).getMonth() + 1).padStart(2, '0')}-${uid().slice(0, 4).toUpperCase()}`,
      employeeId: employee.id,
      employeeName: employee.name,
      periodStart,
      periodEnd,
      ...figures,
      status: 'draft',
      at: Date.now(),
    });
  }
  if (created.length === 0) throw new Error('Payslips already exist for this period');
  await db.transaction('rw', [db.payslips, db.outbox], async () => {
    for (const p of created) {
      await db.payslips.add(p);
      await queueAdvanced('payslips', p);
    }
  });
  return created;
}

export async function payPayslip(id: string): Promise<Payslip> {
  const slip = await db.payslips.get(id);
  if (!slip) throw new Error('Payslip not found');
  if (slip.status === 'paid') throw new Error('This payslip is already paid');
  const next: Payslip = { ...slip, status: 'paid', paidAt: Date.now() };
  await db.transaction('rw', [db.payslips, db.outbox], async () => {
    await db.payslips.put(next);
    await queueAdvanced('payslips', next);
  });
  return next;
}

// ---------------------------------------------------------------------------------------------
// Currencies

export async function saveCurrency(input: { code: string; name: string; symbol: string; rate: number }): Promise<Currency> {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error('Use a three-letter currency code, e.g. USD');
  if (!(input.rate > 0)) throw new Error('Exchange rate must be more than zero');
  const record: Currency = { id: code, code, name: input.name.trim() || code, symbol: input.symbol.trim() || code, rate: input.rate, updatedAt: Date.now() };
  await db.transaction('rw', [db.currencies, db.outbox], async () => {
    await db.currencies.put(record);
    await queueAdvanced('currencies', record);
  });
  return record;
}

/** Base units for an amount in a foreign currency. */
export function toBase(amount: number, rate: number): number {
  return round2(amount * rate);
}

export function fromBase(amount: number, rate: number): number {
  return rate > 0 ? round2(amount / rate) : 0;
}

// ---------------------------------------------------------------------------------------------
// Bank reconciliation

export async function addBankAccount(input: { name: string; bank: string; number: string; accountCode?: string; openingBalance?: number }): Promise<BankAccount> {
  if (!input.name.trim()) throw new Error('Account name is required');
  const record: BankAccount = {
    id: uid(),
    name: input.name.trim(),
    bank: input.bank.trim(),
    number: input.number.trim(),
    accountCode: input.accountCode || '1020',
    openingBalance: round2(input.openingBalance ?? 0),
  };
  await db.transaction('rw', [db.bankAccounts, db.outbox], async () => {
    await db.bankAccounts.add(record);
    await queueAdvanced('bankAccounts', record);
  });
  return record;
}

export async function addBankTransaction(input: { bankAccountId: string; date: number; description: string; amount: number; reference?: string }): Promise<BankTransaction> {
  if (!input.description.trim()) throw new Error('Add a description');
  if (!(input.amount !== 0)) throw new Error('Amount cannot be zero');
  const transaction: BankTransaction = {
    id: uid(),
    bankAccountId: input.bankAccountId,
    date: input.date,
    description: input.description.trim(),
    amount: round2(input.amount),
    status: 'uncleared',
    ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
  };
  await db.transaction('rw', [db.bankTransactions, db.outbox], async () => {
    await db.bankTransactions.add(transaction);
    await queueAdvanced('bankTransactions', transaction);
  });
  return transaction;
}

export async function toggleBankTransaction(id: string): Promise<void> {
  const tx = await db.bankTransactions.get(id);
  if (!tx) return;
  const next = { ...tx, status: tx.status === 'cleared' ? ('uncleared' as const) : ('cleared' as const) };
  await db.transaction('rw', [db.bankTransactions, db.outbox], async () => {
    await db.bankTransactions.put(next);
    await queueAdvanced('bankTransactions', next);
  });
}

export interface Reconciliation {
  statementBalance: number;
  clearedBalance: number;
  bookBalance: number;
  difference: number;
  uncleared: number;
}

export function reconcile(account: BankAccount, transactions: BankTransaction[], bookBalance: number): Reconciliation {
  const statementBalance = round2(account.openingBalance + transactions.reduce((s, t) => s + t.amount, 0));
  const cleared = transactions.filter((t) => t.status === 'cleared');
  const clearedBalance = round2(account.openingBalance + cleared.reduce((s, t) => s + t.amount, 0));
  return {
    statementBalance,
    clearedBalance,
    bookBalance: round2(bookBalance),
    difference: round2(statementBalance - bookBalance),
    uncleared: round2(clearedBalance - bookBalance),
  };
}

export const monthsAgo = (n: number): number => Date.now() - n * MONTH;
