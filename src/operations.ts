// Warehouse, serial tracking and light manufacturing.
// Bin stock is an allocation of on-hand stock, never a second stock count: putting a unit away does
// not change the product total, and picking does not subtract it again (the sale already did).
import { db, uid, type BinMovement, type PickTask, type ProductionOrder, type SerialNumber } from './db';
import { queueAdvanced } from './advanced';
import { currentLocationId } from './location';
import { recordMovement } from './stock';

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Serial numbers

export async function addSerial(input: { productId: string; serial: string; warrantyMonths?: number; batchNo?: string; cost?: number }): Promise<SerialNumber> {
  const serial = input.serial.trim();
  if (!serial) throw new Error('Serial number is required');
  if (serial.length > 80) throw new Error('Serial number is too long');
  const product = await db.products.get(input.productId);
  if (!product) throw new Error('Choose a product');
  const clash = (await db.serials.toArray()).some((s) => s.serial.toLowerCase() === serial.toLowerCase());
  if (clash) throw new Error('That serial number is already registered');
  const at = Date.now();
  const record: SerialNumber = {
    id: uid(),
    productId: product.id,
    productName: product.name,
    serial,
    status: 'in_stock',
    locationId: currentLocationId(),
    at,
    updatedAt: at,
    ...(input.batchNo?.trim() ? { batchNo: input.batchNo.trim() } : {}),
    cost: input.cost ?? product.cost,
    ...(input.warrantyMonths && input.warrantyMonths > 0 ? { warrantyUntil: at + input.warrantyMonths * 30 * 86_400_000 } : {}),
  };
  await db.transaction('rw', [db.serials, db.outbox], async () => {
    await db.serials.add(record);
    await queueAdvanced('serials', record);
  });
  return record;
}

export async function setSerialStatus(id: string, status: SerialNumber['status'], saleId?: string): Promise<SerialNumber> {
  const serial = await db.serials.get(id);
  if (!serial) throw new Error('Serial not found');
  const next: SerialNumber = { ...serial, status, updatedAt: Date.now(), ...(saleId ? { saleId } : {}) };
  await db.transaction('rw', [db.serials, db.outbox], async () => {
    await db.serials.put(next);
    await queueAdvanced('serials', next);
  });
  return next;
}

// ---------------------------------------------------------------------------------------------
// Warehouse bins and picking

export async function addBin(input: { code: string; name?: string; zone?: string; aisle?: string; rack?: string; shelf?: string; bin?: string; locationId?: string }): Promise<void> {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new Error('Bin code is required');
  const locationId = input.locationId ?? currentLocationId();
  const exists = (await db.bins.toArray()).some((b) => b.locationId === locationId && b.code.toUpperCase() === code);
  if (exists) throw new Error('That bin code already exists in this branch');
  await db.transaction('rw', [db.bins, db.outbox], async () => {
    const record = {
      id: uid(), locationId, code,
      name: input.name?.trim() || code,
      ...(input.zone?.trim() ? { zone: input.zone.trim() } : {}),
      ...(input.aisle?.trim() ? { aisle: input.aisle.trim() } : {}),
      ...(input.rack?.trim() ? { rack: input.rack.trim() } : {}),
      ...(input.shelf?.trim() ? { shelf: input.shelf.trim() } : {}),
      ...(input.bin?.trim() ? { bin: input.bin.trim() } : {}),
    };
    await db.bins.add(record);
    await queueAdvanced('bins', record);
  });
}

/** Quantity of each product allocated to each bin, for one branch. */
export async function binStock(locationId = currentLocationId()): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  for (const m of await db.binMovements.toArray()) {
    if (m.locationId !== locationId) continue;
    const perBin = out.get(m.binId) ?? new Map<string, number>();
    perBin.set(m.productId, (perBin.get(m.productId) ?? 0) + m.delta);
    out.set(m.binId, perBin);
  }
  return out;
}

export function binQty(stock: Map<string, Map<string, number>>, binId: string, productId: string): number {
  return stock.get(binId)?.get(productId) ?? 0;
}

export function binnedQty(stock: Map<string, Map<string, number>>, productId: string): number {
  let n = 0;
  for (const perBin of stock.values()) n += perBin.get(productId) ?? 0;
  return n;
}

export async function putAway(input: { productId: string; binId: string; qty: number; ref?: string }): Promise<BinMovement> {
  if (!(input.qty > 0)) throw new Error('Quantity must be more than zero');
  const product = await db.products.get(input.productId);
  if (!product) throw new Error('Product not found');
  const bin = await db.bins.get(input.binId);
  if (!bin || bin.locationId !== currentLocationId()) throw new Error('Choose a bin in this branch');
  const stock = await binStock();
  const available = product.stock - binnedQty(stock, product.id);
  if (input.qty > available + 0.0001) throw new Error(`Only ${available} of ${product.name} is unassigned`);
  const movement: BinMovement = {
    id: uid(), productId: product.id, binId: bin.id, delta: input.qty,
    reason: 'putaway', at: Date.now(), locationId: bin.locationId,
    ...(input.ref?.trim() ? { ref: input.ref.trim() } : {}),
  };
  await db.transaction('rw', [db.binMovements, db.outbox], async () => {
    await db.binMovements.add(movement);
    await queueAdvanced('binMovements', movement);
  });
  return movement;
}

export async function releaseFromBin(binId: string, productId: string, qty: number): Promise<void> {
  if (!(qty > 0)) throw new Error('Quantity must be more than zero');
  const stock = await binStock();
  const available = binQty(stock, binId, productId);
  if (qty > available + 0.0001) throw new Error(`Only ${available} is in that bin`);
  const movement: BinMovement = {
    id: uid(), productId, binId, delta: -qty, reason: 'bin_release', at: Date.now(), locationId: currentLocationId(),
  };
  await db.transaction('rw', [db.binMovements, db.outbox], async () => {
    await db.binMovements.add(movement);
    await queueAdvanced('binMovements', movement);
  });
}

export async function createPickTask(saleId: string): Promise<PickTask> {
  const sale = await db.sales.get(saleId);
  if (!sale) throw new Error('Sale not found');
  if (sale.status !== 'completed') throw new Error('Only completed sales can be picked');
  const existing = (await db.pickTasks.toArray()).find((t) => t.saleId === saleId && t.status !== 'cancelled');
  if (existing) return existing;
  const autoPicked = sale.items.some((l) => l.binPicks?.length);
  if (autoPicked) {
    const task: PickTask = {
      id: uid(),
      number: `PICK-${Date.now().toString().slice(-6)}-${uid().slice(0, 3).toUpperCase()}`,
      saleId,
      saleNumber: sale.number,
      items: sale.items.map((line) => ({ productId: line.productId, name: line.name, qty: line.qty, ...(line.binPicks?.[0]?.binId ? { binId: line.binPicks[0].binId } : {}) })),
      status: 'picked',
      at: Date.now(),
      pickedAt: sale.at,
      locationId: sale.locationId ?? 'main',
    };
    await db.transaction('rw', [db.pickTasks, db.outbox], async () => {
      await db.pickTasks.add(task);
      await queueAdvanced('pickTasks', task);
    });
    return task;
  }
  const locationId = sale.locationId ?? 'main';
  const stock = await binStock(locationId);
  const reserved = new Map<string, number>();
  for (const task of await db.pickTasks.toArray()) {
    if (task.status !== 'pending') continue;
    for (const it of task.items) if (it.binId) reserved.set(`${it.binId}:${it.productId}`, (reserved.get(`${it.binId}:${it.productId}`) ?? 0) + it.qty);
  }
  const bins = (await db.bins.toArray()).filter((b) => b.locationId === locationId).sort((a, b) => a.code.localeCompare(b.code));
  const task: PickTask = {
    id: uid(),
    number: `PICK-${Date.now().toString().slice(-6)}-${uid().slice(0, 3).toUpperCase()}`,
    saleId,
    saleNumber: sale.number,
    items: sale.items.map((line) => {
      let left = line.qty;
      let chosen: string | undefined;
      for (const b of bins) {
        const avail = binQty(stock, b.id, line.productId) - (reserved.get(`${b.id}:${line.productId}`) ?? 0);
        if (avail >= left) { chosen = b.id; break; }
      }
      return { productId: line.productId, name: line.name, qty: line.qty, ...(chosen ? { binId: chosen } : {}) };
    }),
    status: 'pending',
    at: Date.now(),
    locationId,
  };
  await db.transaction('rw', [db.pickTasks, db.outbox], async () => {
    await db.pickTasks.add(task);
    await queueAdvanced('pickTasks', task);
  });
  return task;
}

export async function completePickTask(id: string): Promise<PickTask> {
  const task = await db.pickTasks.get(id);
  if (!task) throw new Error('Pick task not found');
  if (task.status !== 'pending') throw new Error('This task is already closed');
  const stock = await binStock(task.locationId);
  for (const it of task.items) {
    if (!it.binId) continue;
    if (binQty(stock, it.binId, it.productId) < it.qty) throw new Error(`Not enough ${it.name} in the assigned bin`);
  }
  const done: PickTask = { ...task, status: 'picked', pickedAt: Date.now() };
  await db.transaction('rw', [db.binMovements, db.pickTasks, db.outbox], async () => {
    for (const it of task.items) {
      if (!it.binId) continue;
      const movement: BinMovement = {
        id: `${task.id}:${it.productId}:pick`, productId: it.productId, binId: it.binId,
        delta: -it.qty, reason: 'pick', ref: task.id, at: Date.now(), locationId: task.locationId,
      };
      await db.binMovements.add(movement);
      await queueAdvanced('binMovements', movement);
    }
    await db.pickTasks.put(done);
    await queueAdvanced('pickTasks', done);
  });
  return done;
}

// ---------------------------------------------------------------------------------------------
// Bills of materials and production

export async function saveBom(input: { productId: string; name: string; items: { productId: string; qty: number }[]; outputQty?: number; laborCost?: number; overheadCost?: number }): Promise<void> {
  const product = await db.products.get(input.productId);
  if (!product) throw new Error('Choose the finished product');
  if (!input.name.trim()) throw new Error('Give the recipe a name');
  if (!input.items.length) throw new Error('Add at least one component');
  for (const it of input.items) {
    if (!(it.qty > 0)) throw new Error('Component quantities must be more than zero');
    if (!(await db.products.get(it.productId))) throw new Error('A component no longer exists');
  }
  const rows = [];
  for (const it of input.items) {
    const p = (await db.products.get(it.productId))!;
    rows.push({ productId: p.id, name: p.name, qty: it.qty });
  }
  const record = {
    id: uid(),
    productId: product.id,
    name: input.name.trim(),
    items: rows,
    outputQty: input.outputQty && input.outputQty > 0 ? input.outputQty : 1,
    laborCost: Math.max(0, input.laborCost ?? 0),
    overheadCost: Math.max(0, input.overheadCost ?? 0),
    active: true,
  };
  await db.transaction('rw', [db.boms, db.outbox], async () => {
    await db.boms.add(record);
    await queueAdvanced('boms', record);
  });
}

export async function createProductionOrder(bomId: string, qty: number): Promise<ProductionOrder> {
  if (!(qty > 0)) throw new Error('Quantity must be more than zero');
  const bom = await db.boms.get(bomId);
  if (!bom) throw new Error('Recipe not found');
  const finished = await db.products.get(bom.productId);
  if (!finished) throw new Error('Finished product not found');
  const allBoms = (await db.boms.toArray()).filter((b) => b.active);
  const raw = new Map<string, { productId: string; name: string; qty: number }>();
  let subLabor = 0;
  let subOverhead = 0;

  const explode = (current: typeof bom, factor: number, depth: number, path: string[]): void => {
    if (depth > 8) throw new Error('This bill of materials is nested too deeply');
    if (path.includes(current.id)) throw new Error('This bill of materials contains a cycle');
    const nextPath = [...path, current.id];
    const localFactor = factor / current.outputQty;
    for (const it of current.items) {
      const needed = it.qty * localFactor;
      const child = allBoms.find((b) => b.productId === it.productId);
      if (child) {
        subLabor += child.laborCost * (needed / child.outputQty);
        subOverhead += child.overheadCost * (needed / child.outputQty);
        explode(child, needed, depth + 1, nextPath);
      } else {
        const row = raw.get(it.productId) ?? { productId: it.productId, name: it.name, qty: 0 };
        row.qty += needed;
        raw.set(it.productId, row);
      }
    }
  };
  explode(bom, qty, 0, []);

  let componentCost = 0;
  for (const it of raw.values()) {
    const p = await db.products.get(it.productId);
    componentCost += (p?.cost ?? 0) * it.qty;
  }
  const laborCost = round2(bom.laborCost * (qty / bom.outputQty) + subLabor);
  const overheadCost = round2(bom.overheadCost * (qty / bom.outputQty) + subOverhead);
  const total = round2(componentCost + laborCost + overheadCost);
  const order: ProductionOrder = {
    id: uid(),
    number: `MO-${Date.now().toString().slice(-6)}-${uid().slice(0, 3).toUpperCase()}`,
    bomId,
    productId: bom.productId,
    name: `${qty} × ${finished.name}`,
    qty,
    status: 'planned',
    at: Date.now(),
    componentCost: round2(componentCost),
    laborCost,
    overheadCost,
    unitCost: round2(total / qty),
    components: [...raw.values()].map((r) => ({ productId: r.productId, name: r.name, qty: round2(r.qty) })),
    locationId: currentLocationId(),
  };
  await db.transaction('rw', [db.productionOrders, db.outbox], async () => {
    await db.productionOrders.add(order);
    await queueAdvanced('productionOrders', order);
  });
  return order;
}

export async function completeProductionOrder(id: string): Promise<ProductionOrder> {
  const order = await db.productionOrders.get(id);
  if (!order) throw new Error('Production order not found');
  if (order.status !== 'planned') throw new Error('This order is already closed');
  const bom = await db.boms.get(order.bomId);
  if (!bom) throw new Error('Recipe not found');
  const factor = order.qty / bom.outputQty;
  const needs = order.components?.length
    ? order.components.map((c) => ({ productId: c.productId, qty: c.qty }))
    : bom.items.map((it) => ({ productId: it.productId, qty: it.qty * factor }));
  for (const it of needs) {
    const p = await db.products.get(it.productId);
    if (!p) throw new Error('A component no longer exists');
    if (p.stock < it.qty) throw new Error(`Only ${p.stock} of ${p.name} is available`);
  }
  const done: ProductionOrder = { ...order, status: 'completed', completedAt: Date.now() };
  await db.transaction('rw', [db.products, db.stockMovements, db.productionOrders, db.outbox], async () => {
    for (const it of needs) {
      const p = (await db.products.get(it.productId))!;
      const movement = {
        id: `${order.id}:${it.productId}:consume`,
        productId: it.productId,
        delta: -round2(it.qty),
        reason: 'production_consume',
        ref: order.id,
        at: Date.now(),
        locationId: order.locationId,
      };
      await recordMovement(movement);
      await db.outbox.add({ entity: 'stock_movement', op: 'create', payload: movement, at: Date.now() });
      const next = (await db.products.get(it.productId))!;
      if (next.stock < 0) throw new Error(`${p.name} went negative during production`);
    }
    const output = {
      id: `${order.id}:output`,
      productId: order.productId,
      delta: order.qty,
      reason: 'production_output',
      ref: order.id,
      at: Date.now(),
      locationId: order.locationId,
    };
    await recordMovement(output);
    await db.outbox.add({ entity: 'stock_movement', op: 'create', payload: output, at: Date.now() });
    const finished = await db.products.get(order.productId);
    if (finished) await db.products.put({ ...finished, cost: order.unitCost, costAt: Date.now(), updatedAt: Date.now() });
    await db.productionOrders.put(done);
    await queueAdvanced('productionOrders', done);
  });
  return done;
}
