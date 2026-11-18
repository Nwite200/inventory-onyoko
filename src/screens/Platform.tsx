import { useEffect, useState } from 'react';
import { api, getSession } from '../auth';
import { Icon } from '../components/Icon';

interface Overview {
  totals: { businesses: number; users: number; changes: number };
  businesses: { id: string; name: string; created_at: number; users: number; changes: number; last_change: number | null }[];
  health: { uptimeSeconds: number; memoryMb: number; dbBytes: number; node: string };
}
interface AuditEvent {
  seq: number;
  entity: string;
  op: string;
  at: number;
  user: string;
  business: string;
}

const ago = (at: number | null): string => {
  if (!at) return '—';
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export function Platform() {
  const session = getSession();
  const [data, setData] = useState<Overview | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', adminUsername: '', adminPassword: '' });
  const [created, setCreated] = useState('');

  const load = async () => {
    if (!session) return;
    try {
      const [overview, audit] = await Promise.all([
        api<Overview>('GET', '/api/admin/overview', undefined, session.token),
        api<{ events: AuditEvent[] }>('GET', '/api/admin/audit?limit=40', undefined, session.token),
      ]);
      setData(overview);
      setEvents(audit.events);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load platform data');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || busy) return;
    setBusy(true);
    setError('');
    setCreated('');
    try {
      await api('POST', '/api/businesses', form, session.token);
      setCreated(`${form.name} was created.`);
      setForm({ name: '', adminUsername: '', adminPassword: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the business');
    } finally {
      setBusy(false);
    }
  };

  if (!session?.isSuper) {
    return (
      <div className="empty-state">
        <span className="empty-ico"><Icon name="lock" size={20} /></span>
        <strong>Platform administration</strong>
        <p>Only the platform owner can open this workspace.</p>
      </div>
    );
  }

  return (
    <div className="platform-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Platform</span>
          <h1>Platform administration</h1>
          <p className="lede">Tenant metadata, sync volume and system health. Business records stay inside each tenant.</p>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-secondary" onClick={() => void load()}><Icon name="refund" size={15} /> Refresh</button>
        </div>
      </header>

      {error && <div className="alert-error" role="alert">{error}</div>}
      {created && <div className="alert-success">{created}</div>}

      {!data ? (
        <div className="skeleton-grid">{Array.from({ length: 4 }, (_, i) => <div className="skeleton-card" key={i} />)}</div>
      ) : (
        <>
          <section className="kpi-grid">
            <article className="kpi-card"><div className="kpi-top"><span className="kpi-label">Businesses</span><span className="kpi-ico"><Icon name="store" size={16} /></span></div><div className="kpi-value">{data.totals.businesses}</div><div className="kpi-foot"><span className="kpi-context">Separate tenants</span></div></article>
            <article className="kpi-card"><div className="kpi-top"><span className="kpi-label">Accounts</span><span className="kpi-ico ico-emerald"><Icon name="users" size={16} /></span></div><div className="kpi-value">{data.totals.users}</div><div className="kpi-foot"><span className="kpi-context">Across all businesses</span></div></article>
            <article className="kpi-card"><div className="kpi-top"><span className="kpi-label">Sync events</span><span className="kpi-ico ico-amber"><Icon name="history" size={16} /></span></div><div className="kpi-value">{data.totals.changes.toLocaleString()}</div><div className="kpi-foot"><span className="kpi-context">Append-only change log</span></div></article>
            <article className="kpi-card"><div className="kpi-top"><span className="kpi-label">System</span><span className="kpi-ico ico-sky"><Icon name="settings" size={16} /></span></div><div className="kpi-value">{`${(data.health.dbBytes / 1024 / 1024).toFixed(1)} MB`}</div><div className="kpi-foot"><span className="kpi-context">DB · {data.health.memoryMb} MB RAM · up {Math.floor(data.health.uptimeSeconds / 60)}m</span></div></article>
          </section>

          <section className="dashboard-main">
            <article className="panel">
              <header className="panel-head"><div><h3>Businesses</h3><p className="panel-sub">Metadata only — no customer, sales or accounting records</p></div></header>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Business</th><th className="num">Users</th><th className="num">Sync events</th><th>Last activity</th><th>Created</th></tr></thead>
                  <tbody>
                    {data.businesses.map((b) => (
                      <tr key={b.id}>
                        <td><strong>{b.name}</strong><div className="muted small fw-mono">{b.id.slice(0, 12)}</div></td>
                        <td className="num">{b.users}</td>
                        <td className="num">{b.changes.toLocaleString()}</td>
                        <td className="muted">{ago(b.last_change)}</td>
                        <td className="muted">{new Date(b.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="panel">
              <header className="panel-head"><div><h3>Create a business</h3><p className="panel-sub">Each tenant gets its own admin and data boundary</p></div></header>
              <form className="panel-body form" onSubmit={addBusiness}>
                <label className="field"><span>Business name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
                <div className="form-grid two-col">
                  <label className="field"><span>Admin username</span><input value={form.adminUsername} onChange={(e) => setForm({ ...form, adminUsername: e.target.value })} required /></label>
                  <label className="field"><span>Admin password</span><input type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} required /></label>
                </div>
                <button className="btn btn-primary" disabled={busy}><Icon name="plus" size={15} /> {busy ? 'Creating…' : 'Create business'}</button>
                <p className="panel-sub">The super administrator cannot read a tenant's products, customers, sales or ledger.</p>
              </form>
            </article>
          </section>

          <section className="panel">
            <header className="panel-head"><div><h3>Recent platform activity</h3><p className="panel-sub">Entity and operation only; payloads are not exposed</p></div></header>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Seq</th><th>Business</th><th>User</th><th>Entity</th><th>Operation</th><th>When</th></tr></thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.seq}>
                      <td className="fw-mono muted">{e.seq}</td>
                      <td>{e.business || '—'}</td>
                      <td>{e.user}</td>
                      <td><span className="badge badge-subtle">{e.entity}</span></td>
                      <td>{e.op}</td>
                      <td className="muted">{ago(e.at)}</td>
                    </tr>
                  ))}
                  {events.length === 0 && <tr><td colSpan={6} className="empty-table-cell">No sync activity yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
