// Refunds with real integrity rules:
//  - never refund more than was sold, counting earlier refunds on the same sale
//  - restocked lines create deterministic stock movements (a replay cannot restock twice)
//  - the refund, the stock movements and the sync event are written in one transaction
import { db, uid, type SaleReturn, type SaleReturnItem } from './db';
import { currentLocationId } from './location';
import { recordMovement } from './stock';
import { requireApproval } from './approvals';
import { proportionalTax } from './tax';

export interface RefundInput {
  saleId: string;
  items: { productId: string; qty: number; condition: 'restock' | 'damaged'; serials?: string[] }[];
  paymentMethod?: string;
  reason?: string;
  at?: number;
}

/** Units already refunded for each product on a sale (voided refunds excluded). */
export async function returnedQuantities(saleId: string): Promise<Map<string, number>> {
  const prior = await db.returns.where('saleId').equals(saleId).toArray();
  const out = new Map<string, number>();
  for (const r of prior) {
    if (r.status !== 'completed') continue;
    for (const it of r.items) out.set(it.productId, (out.get(it.productId) ?? 0) + it.qty);
  }
  return out;
}

export async function refundSale(input: RefundInput): Promise<SaleReturn> {
  if (input.items.length === 0) throw new Error('Select at least one item to refund');
  const sale = await db.sales.get(input.saleId);
  if (!sale) throw new Error('Sale not found on this device');
  if (sale.status === 'voided') throw new Error('That sale was voided; its stock was already returned');

  const already = await returnedQuantities(sale.id);
  const catalogue = new Map((await db.products.toArray()).map((p) => [p.id, p.cost]));
  const priorReturns = await db.returns.where('saleId').equals(sale.id).toArray();
  const items: SaleReturnItem[] = [];
  for (const requested of input.items) {
    if (!(requested.qty > 0)) continue;
    const line = sale.items.find((i) => i.productId === requested.productId);
    if (!line) throw new Error('That item was not part of this sale');
    const remaining = line.qty - (already.get(line.productId) ?? 0);
    if (requested.qty > remaining + 0.0001) {
      throw new Error(`Only ${remaining} of ${line.name} can still be refunded`);
    }
    let serials: string[] | undefined;
    if (line.serials?.length) {
      const available = new Set<string>();
      for (const serialId of line.serials) {
        const serial = await db.serials.get(serialId);
        if (serial && serial.status === 'sold' && serial.saleId === sale.id) available.add(serialId);
      }
      const chosen = [...new Set(requested.serials ?? [])];
      if (chosen.length !== requested.qty) throw new Error(`Choose ${requested.qty} serial number${requested.qty === 1 ? '' : 's'} to return`);
      for (const serialId of chosen) if (!available.has(serialId)) throw new Error('That serial was not sold on this sale');
      serials = chosen;
    }
    let binReturns: { binId: string; qty: number }[] | undefined;
    if (line.binPicks?.length && requested.condition === 'restock') {
      const alreadyReturned = new Map<string, number>();
      for (const prior of priorReturns) {
        for (const it of prior.items) {
          if (it.productId !== line.productId) continue;
          for (const b of it.binReturns ?? []) alreadyReturned.set(b.binId, (alreadyReturned.get(b.binId) ?? 0) + b.qty);
        }
      }
      let left = requested.qty;
      binReturns = [];
      for (const pick of line.binPicks) {
        if (left <= 0) break;
        const open = pick.qty - (alreadyReturned.get(pick.binId) ?? 0);
        const take = Math.min(left, Math.max(0, open));
        if (take > 0) binReturns.push({ binId: pick.binId, qty: take });
        left -= take;
      }
    }
    items.push({
      productId: line.productId,
      name: line.name,
      qty: requested.qty,
      unitPrice: line.price,
      refundAmount: Math.round(requested.qty * line.price * 100) / 100,
      condition: requested.condition,
      cost: line.cost ?? catalogue.get(line.productId) ?? 0,
      ...(serials ? { serials } : {}),
      ...(binReturns?.length ? { binReturns } : {}),
    });
  }
  if (items.length === 0) throw new Error('Select a quantity to refund');

  const at = input.at ?? Date.now();
  const id = uid();
  const locationId = sale.locationId ?? currentLocationId();
  const totalRefunded = Math.round(items.reduce((s, i) => s + i.refundAmount, 0) * 100) / 100;
  const approval = await requireApproval('refund', sale.id, totalRefunded);
  const record: SaleReturn = {
    id,
    number: `RET-${at.toString().slice(-6)}-${id.slice(0, 4).toUpperCase()}`,
    saleId: sale.id,
    saleNumber: sale.number,
    at,
    customerName: sale.customerName,
    items,
    totalRefunded,
    tax: proportionalTax(sale, totalRefunded),
    paymentMethod: input.paymentMethod ?? 'cash',
    reason: input.reason?.trim() || 'Customer return',
    locationId,
    status: 'completed',
    ...(approval ? { approvalId: approval.id } : {}),
  };

  await db.transaction('rw', [db.products, db.stockMovements, db.returns, db.serials, db.binMovements, db.outbox], async () => {
    await db.returns.add(record);
    for (const it of items) {
      if (it.condition === 'restock') {
        await recordMovement({
          id: `${record.id}:${it.productId}:restock`,
          productId: it.productId,
          delta: it.qty,
          reason: 'return_restock',
          ref: record.id,
          at,
          locationId,
        });
        for (const b of it.binReturns ?? []) {
          await db.binMovements.add({
            id: `${record.id}:${it.productId}:${b.binId}:bin`,
            productId: it.productId,
            binId: b.binId,
            delta: b.qty,
            reason: 'return_restock',
            ref: record.id,
            at,
            locationId,
          });
        }
      }
      for (const serialId of it.serials ?? []) {
        const serial = await db.serials.get(serialId);
        if (!serial) continue;
        await db.serials.put({
          ...serial,
          status: it.condition === 'restock' ? 'in_stock' : 'damaged',
          saleId: it.condition === 'restock' ? undefined : serial.saleId,
          updatedAt: Date.now(),
        });
      }
    }
    await db.outbox.add({ entity: 'sale_return', op: 'create', payload: record, at: Date.now() });
  });

  return record;
}
