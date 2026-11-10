// Shops. Products are shared by every shop, but stock is counted per shop.
// Each device belongs to one shop; the number on screen is that shop's stock.
// Every device keeps ALL stock movements (each tagged with its shop), so switching a device
// to another shop just re-adds the movements for the new shop.
import { db, uid, type Location } from './db';

export const MAIN_LOCATION = 'main';
const KEY = 'openpos.location';

export function currentLocationId(): string {
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) || MAIN_LOCATION;
  } catch {
    return MAIN_LOCATION;
  }
}

/** Shops known on this device. "main" always exists, even before anything is synced. */
export async function listLocations(): Promise<Location[]> {
  const all = await db.locations.toArray();
  if (!all.some((l) => l.id === MAIN_LOCATION)) all.unshift({ id: MAIN_LOCATION, name: 'Main shop' });
  return all.sort((a, b) => (a.id === MAIN_LOCATION ? -1 : b.id === MAIN_LOCATION ? 1 : a.name.localeCompare(b.name)));
}

export async function locationName(id: string): Promise<string> {
  return (await listLocations()).find((l) => l.id === id)?.name ?? id;
}

/** Rebuilds every product's stock from the movements belonging to this device's shop. */
export async function recomputeStock(): Promise<void> {
  const here = currentLocationId();
  await db.transaction('rw', db.products, db.stockMovements, async () => {
    const totals = new Map<string, number>();
    await db.stockMovements.each((m) => {
      if ((m.locationId ?? MAIN_LOCATION) === here) totals.set(m.productId, (totals.get(m.productId) ?? 0) + m.delta);
    });
    for (const p of await db.products.toArray()) {
      const stock = totals.get(p.id) ?? 0;
      if (stock !== p.stock) await db.products.put({ ...p, stock });
    }
  });
}

export async function setCurrentLocation(id: string): Promise<void> {
  localStorage.setItem(KEY, id);
  await recomputeStock();
}

/** Admin only on the server. Returns the new shop. */
export async function addLocation(name: string): Promise<Location> {
  const n = name.trim();
  if (!n) throw new Error('Shop name is required');
  if ((await listLocations()).some((l) => l.name.toLowerCase() === n.toLowerCase())) throw new Error('A shop with that name already exists');
  const loc: Location = { id: uid(), name: n };
  await db.transaction('rw', db.locations, db.outbox, async () => {
    await db.locations.add(loc);
    await db.outbox.add({ entity: 'location', op: 'create', payload: loc, at: Date.now() });
  });
  return loc;
}
