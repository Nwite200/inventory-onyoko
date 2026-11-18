// Expense recording with the same approval policy as refunds and voids.
import { db, uid, type Expense } from './db';
import { requireApproval } from './approvals';
import { currentLocationId } from './location';

export async function recordExpense(input: {
  id?: string;
  category: string;
  amount: number;
  paymentMethod: string;
  note?: string;
  at?: number;
  createdBy?: string;
}): Promise<Expense> {
  if (!(input.amount > 0)) throw new Error('Amount must be more than zero');
  const id = input.id ?? uid();
  await requireApproval('expense', id, input.amount);
  const expense: Expense = {
    id,
    category: input.category,
    amount: Math.round(input.amount * 100) / 100,
    paymentMethod: input.paymentMethod,
    at: input.at ?? Date.now(),
    locationId: currentLocationId(),
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
  await db.transaction('rw', [db.expenses, db.outbox], async () => {
    await db.expenses.add(expense);
    await db.outbox.add({ entity: 'expense', op: 'create', payload: expense, at: Date.now() });
  });
  return expense;
}
