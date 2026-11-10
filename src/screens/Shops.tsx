import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { addLocation, currentLocationId, listLocations, setCurrentLocation } from '../location';

/** Which shop this device belongs to, and (owner only) adding shops. */
export function Shops({ isAdmin }: { isAdmin: boolean }) {
  const locs = useLiveQuery(async () => { await db.locations.count(); return listLocations(); }, [], []);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [, bump] = useState(0);

  return (
    <div className="card form">
      <h3>Shops</h3>
      <p className="small muted">Products are shared, but stock is counted per shop. Each device belongs to one shop; the stock numbers it shows are that shop's.</p>
      <label>
        This device is in
        <select
          aria-label="This device's shop"
          value={currentLocationId()}
          onChange={(e) => void setCurrentLocation(e.target.value).then(() => bump((n) => n + 1))}
        >
          {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      {isAdmin && (
        <form
          className="row-btns"
          onSubmit={async (e) => {
            e.preventDefault();
            setMsg('');
            try {
              await addLocation(name);
              setName('');
            } catch (err) {
              setMsg(err instanceof Error ? err.message : 'Could not add the shop');
            }
          }}
        >
          <input placeholder="New shop name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: '1 1 160px' }} />
          <button className="primary" disabled={!name.trim()}>Add shop</button>
        </form>
      )}
      {msg && <p className="error">{msg}</p>}
    </div>
  );
}
