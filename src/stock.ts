// The ONE place stock numbers change. Callers must be inside a transaction that includes
// db.products and db.stockMovements.
import { db, type StockMovement } from './db';
import { MAIN_LOCATION, currentLocationId } from './location';

/**
 * Records a movement (ignored if one with this id exists, so repeats are harmless) and, when it
 * belongs to this device's shop, changes the product's stock number. Returns false for a repeat.
 */
export async function recordMovement(m: Omit<StockMovement, 'locationId'> & { locationId?: string }): Promise<boolean> {
  if (await db.stockMovements.get(m.id)) return false;
  const locationId = m.locationId ?? MAIN_LOCATION;
  await db.stockMovements.add({ ...m, locationId });
  if (locationId === currentLocationId()) {
    const p = await db.products.get(m.productId);
    if (p) await db.products.put({ ...p, stock: p.stock + m.delta, updatedAt: Date.now() });
  }
  return true;
}
