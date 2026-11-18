// Approval requests for sensitive actions. Offline devices record the request and the decision;
// the server stores both as advanced changes. Threshold 0 disables the workflow.
import { config } from './config';
import { db, uid, type Approval } from './db';
import { queueAdvanced } from './advanced';
import { getSession } from './auth';

export const APPROVAL_REQUIRED = 'Approval required:';

export async function requestApproval(input: { kind: Approval['kind']; entityId: string; summary: string; amount: number; requestedBy?: string }): Promise<Approval> {
  const existing = (await db.approvals.toArray()).find((a) => a.kind === input.kind && a.entityId === input.entityId && a.status === 'pending');
  if (existing) return existing;
  const record: Approval = {
    id: uid(),
    kind: input.kind,
    entityId: input.entityId,
    summary: input.summary,
    amount: Math.round(input.amount * 100) / 100,
    requestedBy: input.requestedBy ?? getSession()?.username ?? 'local',
    requestedAt: Date.now(),
    status: 'pending',
  };
  await db.transaction('rw', [db.approvals, db.outbox], async () => {
    await db.approvals.add(record);
    await queueAdvanced('approvals', record);
  });
  return record;
}

export async function decideApproval(id: string, approved: boolean, note = '', decidedBy?: string): Promise<Approval> {
  const record = await db.approvals.get(id);
  if (!record) throw new Error('Approval request not found');
  if (record.status !== 'pending') throw new Error('This request has already been decided');
  const next: Approval = {
    ...record,
    status: approved ? 'approved' : 'rejected',
    decidedBy: decidedBy ?? getSession()?.username ?? 'local',
    decidedAt: Date.now(),
    ...(note.trim() ? { note: note.trim() } : {}),
  };
  await db.transaction('rw', [db.approvals, db.outbox], async () => {
    await db.approvals.put(next);
    await queueAdvanced('approvals', next);
  });
  return next;
}

export async function approvedApproval(kind: Approval['kind'], entityId: string): Promise<Approval | undefined> {
  return (await db.approvals.toArray()).find((a) => a.kind === kind && a.entityId === entityId && a.status === 'approved');
}

/** Throws a recognisable error when the configured threshold is crossed without approval. */
export async function requireApproval(kind: Approval['kind'], entityId: string, amount: number): Promise<Approval | undefined> {
  if (config.approvalThreshold > 0 && amount > config.approvalThreshold) {
    const approved = await approvedApproval(kind, entityId);
    if (!approved || approved.amount + 0.005 < amount) throw new Error(`${APPROVAL_REQUIRED} a manager must approve this ${kind} before it can be posted.`);
    return approved;
  }
  return undefined;
}
