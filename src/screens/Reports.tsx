import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { lowStock, salesSummary, startOfDay } from '../actions';
import { formatMoney } from '../config';
import { listLocations } from '../location';

const DAY = 86_400_000;

export function Reports() {
  const [shop, setShop] = useState<'this' | 'all'>('this');
  const shops = useLiveQuery(async () => (await listLocations()).length, [], 1);
  // depend on the table contents so the numbers refresh after every sale
  const data = useLiveQuery(async () => {
    await db.sales.count();
    const today = startOfDay();
    const [d, w, m, low] = await Promise.all([
      salesSummary(today, shop),
      salesSummary(today - 6 * DAY, shop),
      salesSummary(today - 29 * DAY, shop),
      lowStock(),
    ]);
    return { d, w, m, low };
  }, [shop]);

  if (!data) return <p className="muted">Loading…</p>;
  const { d, w, m, low } = data;
  const card = (label: string, s: typeof d) => (
    <div className="card stat">
      <div className="muted small">{label}</div>
      <div className="big-number">{formatMoney(s.total)}</div>
      <div className="small muted">{s.count} sales</div>
    </div>
  );

  return (
    <div>
      {shops > 1 && (
        <div className="row-btns" style={{ marginBottom: 12 }}>
          <button className={shop === 'this' ? 'primary' : ''} onClick={() => setShop('this')}>This shop</button>
          <button className={shop === 'all' ? 'primary' : ''} onClick={() => setShop('all')}>All shops</button>
        </div>
      )}
      <div className="stats">
        {card('Today', d)}
        {card('Last 7 days', w)}
        {card('Last 30 days', m)}
      </div>
      <div className="two">
        <div className="card">
          <h3>Top sellers today</h3>
          {d.top.length === 0 ? <p className="muted">No sales yet today.</p> : d.top.map((t) => <div className="row" key={t.name}><span>{t.name}</span><span>{t.qty}</span></div>)}
        </div>
        <div className="card">
          <h3>Running low</h3>
          {low.length === 0 ? <p className="muted">All stock levels are healthy.</p> : low.map((p) => <div className="row" key={p.id}><span>{p.name}</span><span className="warn-text">{p.stock} left</span></div>)}
        </div>
      </div>
    </div>
  );
}
