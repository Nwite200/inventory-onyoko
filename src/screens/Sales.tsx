import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Sale } from '../db';
import { voidSale } from '../actions';
import { config, formatMoney } from '../config';
import { Receipt } from './Pos';

export function Sales({ canManage }: { canManage: boolean }) {
  const sales = useLiveQuery(() => db.sales.orderBy('at').reverse().limit(100).toArray(), [], []);
  const [view, setView] = useState<Sale | null>(null);
  const [error, setError] = useState('');

  return (
    <div>
      <h3>Recent sales</h3>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>When</th>
              <th>Customer</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id} className={s.status === 'voided' ? 'voided' : ''}>
                <td>{s.number}</td>
                <td>{new Date(s.at).toLocaleString(config.locale)}</td>
                <td>{s.customerName}</td>
                <td>
                  {formatMoney(s.total)} <span className="small muted">{s.payment}</span>
                  {s.status === 'voided' && <span className="pill warn">voided</span>}
                </td>
                <td className="adjust">
                  <button onClick={() => setView(s)}>View</button>
                  {canManage && s.status === 'completed' && (
                    <button
                      className="danger"
                      onClick={async () => {
                        if (!confirm(`Void ${s.number}? Stock will be returned.`)) return;
                        setError('');
                        try {
                          await voidSale(s.id);
                        } catch (e) {
                          setError(e instanceof Error ? e.message : 'Could not void');
                        }
                      }}
                    >
                      Void
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sales.length === 0 && <p className="muted">No sales yet.</p>}
      </div>
      {view && <Receipt sale={view} onClose={() => setView(null)} />}
    </div>
  );
}
