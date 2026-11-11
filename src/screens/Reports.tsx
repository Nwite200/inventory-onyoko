import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { lowStock, salesSummary, startOfDay } from '../actions';
import { config, formatMoney } from '../config';
import { listLocations } from '../location';
import { t } from '../i18n';
import { expiryReport } from '../lots';

const DAY = 86_400_000;

export function Reports() {
  const [shop, setShop] = useState<'this' | 'all'>('this');
  const hasLots = useLiveQuery(() => db.lots.count().then((n) => n > 0), [], false);
  const shops = useLiveQuery(async () => (await listLocations()).length, [], 1);
  // depend on the table contents so the numbers refresh after every sale
  const data = useLiveQuery(async () => {
    await db.sales.count();
    const today = startOfDay();
    await db.lots.count();
    const [d, w, m, low, expiring] = await Promise.all([
      salesSummary(today, shop),
      salesSummary(today - 6 * DAY, shop),
      salesSummary(today - 29 * DAY, shop),
      lowStock(),
      expiryReport(30),
    ]);
    return { d, w, m, low, expiring };
  }, [shop]);

  if (!data) return <p className="muted">{t('reports.loading')}</p>;
  const { d, w, m, low, expiring } = data;
  const card = (label: string, s: typeof d) => (
    <div className="card stat">
      <div className="muted small">{label}</div>
      <div className="big-number">{formatMoney(s.total)}</div>
      <div className="small muted">{t('reports.sales', { n: s.count })}</div>
    </div>
  );

  return (
    <div>
      {shops > 1 && (
        <div className="row-btns" style={{ marginBottom: 12 }}>
          <button className={shop === 'this' ? 'primary' : ''} onClick={() => setShop('this')}>{t('reports.thisShop')}</button>
          <button className={shop === 'all' ? 'primary' : ''} onClick={() => setShop('all')}>{t('reports.allShops')}</button>
        </div>
      )}
      <div className="stats">
        {card(t('reports.today'), d)}
        {card(t('reports.last7'), w)}
        {card(t('reports.last30'), m)}
      </div>
      <div className="two">
        <div className="card">
          <h3>{t('reports.top')}</h3>
          {d.top.length === 0 ? <p className="muted">{t('reports.noSales')}</p> : d.top.map((t) => <div className="row" key={t.name}><span>{t.name}</span><span>{t.qty}</span></div>)}
        </div>
        <div className="card">
          <h3>{t('reports.low')}</h3>
          {low.length === 0 ? <p className="muted">{t('reports.healthy')}</p> : low.map((p) => <div className="row" key={p.id}><span>{p.name}</span><span className="warn-text">{t('reports.left', { n: p.stock })}</span></div>)}
        </div>
      </div>
      {(expiring.length > 0 || hasLots) && (
        <div className="card">
          <h3>{t('reports.expiry')}</h3>
          {expiring.length === 0 ? <p className="muted">{t('reports.expiryNone')}</p> : expiring.map((r) => (
            <div className="row" key={r.lotId}>
              <span>{r.remaining} × {r.name}{r.batchNo ? ` (${r.batchNo})` : ''}</span>
              <span className={r.expired ? 'warn-text' : 'muted'}>{t(r.expired ? 'reports.expiredOn' : 'reports.expiresOn', { date: new Date(r.expiresAt).toLocaleDateString(config.locale) })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
