// The advanced modules share one sync envelope: { table, record }. The server validates the
// table name and record id, and stores it in the same append-only change log as core entities.
import { db } from './db';

export type AdvancedTable =
  | 'serials'
  | 'bins'
  | 'binMovements'
  | 'pickTasks'
  | 'boms'
  | 'productionOrders'
  | 'assets'
  | 'budgets'
  | 'employees'
  | 'payslips'
  | 'currencies'
  | 'taxRates'
  | 'bankAccounts'
  | 'bankTransactions'
  | 'approvals'
  | 'saleDocuments'
  | 'customerPayments'
  | 'categories';

export const ADVANCED_TABLES: AdvancedTable[] = [
  'serials', 'bins', 'binMovements', 'pickTasks', 'boms', 'productionOrders', 'assets', 'budgets',
  'employees', 'payslips', 'currencies', 'taxRates', 'bankAccounts', 'bankTransactions', 'approvals',
  'saleDocuments', 'customerPayments', 'categories',
];

export const isAdvancedTable = (v: unknown): v is AdvancedTable => typeof v === 'string' && (ADVANCED_TABLES as string[]).includes(v);

export async function queueAdvanced(table: AdvancedTable, record: { id: string }, op: 'upsert' | 'delete' = 'upsert'): Promise<void> {
  await db.outbox.add({ entity: 'advanced', op, payload: { table, record }, at: Date.now() });
}
