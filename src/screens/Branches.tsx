import { Shops } from './Shops';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { listLocations } from '../location';

export function Branches({ isAdmin }: { isAdmin: boolean }) {
  const locations = useLiveQuery(async () => { await db.locations.count(); return listLocations(); }, [], []);
  return (
    <div className="branches-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Locations</span>
          <h1>Branches</h1>
          <p className="lede">{locations.length} branch{locations.length === 1 ? '' : 'es'} · stock is counted per branch while the catalogue stays shared.</p>
        </div>
      </header>
      <section className="advanced-grid">
        <Shops isAdmin={isAdmin} />
        <article className="panel">
          <header className="panel-head"><div><h3>Branch directory</h3><p className="panel-sub">Every device belongs to one branch</p></div></header>
          <ul className="branch-list">
            {locations.map((l) => (
              <li key={l.id}><span><strong>{l.name}</strong><small className="fw-mono">{l.id.slice(0, 12)}</small></span><span className="badge badge-subtle">{l.id === 'main' ? 'Main' : 'Branch'}</span></li>
            ))}
          </ul>
        </article>
      </section>
    </div>
  );
}
