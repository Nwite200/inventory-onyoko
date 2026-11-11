import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { config } from './config';
import { AUTH_EVENT, getSession, logout, serverMode } from './auth';
import { SYNC_EVENT, syncStatus } from './sync';
import type { Role } from './voice/agent';
import { Pos } from './screens/Pos';
import { Products } from './screens/Products';
import { Sales } from './screens/Sales';
import { Reports } from './screens/Reports';
import { Settings } from './screens/Settings';
import { Purchases } from './screens/Purchases';
import { Transfers } from './screens/Transfers';
import { VoiceDock } from './screens/VoiceDock';
import { Login } from './screens/Login';
import { INSECURE_MESSAGE, isSecure } from './secure';
import { currentLocationId, listLocations } from './location';
import { t } from './i18n';

type Tab = 'pos' | 'products' | 'purchases' | 'transfers' | 'sales' | 'reports' | 'settings';

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Re-renders when any of the given window events fire. */
function useEvents(...names: string[]): void {
  const [, bump] = useState(0);
  useEffect(() => {
    const h = () => bump((n) => n + 1);
    names.forEach((n) => window.addEventListener(n, h));
    return () => names.forEach((n) => window.removeEventListener(n, h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function App() {
  const [tab, setTab] = useState<Tab>('pos');
  const [localRole, setLocalRole] = useState<Role>(() => (localStorage.getItem('openpos.role') as Role) || 'admin');
  const [, force] = useState(0); // re-render after settings change
  const online = useOnline();
  const queued = useLiveQuery(() => db.outbox.count(), [], 0);
  // shown only when the business has more than one shop, so a cashier can see which shop this device sells for
  const shopName = useLiveQuery(async () => {
    await db.locations.count();
    const all = await listLocations();
    return all.length > 1 ? (all.find((l) => l.id === currentLocationId())?.name ?? '') : '';
  }, [tab], '');
  useEvents(AUTH_EVENT, SYNC_EVENT);

  const serverOn = serverMode();
  const session = serverOn ? getSession() : null;

  if (serverOn && !session) return <Login onServerChange={() => force((n) => n + 1)} />;

  // With a server, the role comes from the account (and the server enforces it).
  // Without one, the selector below is only a convenience on a trusted device.
  const role: Role = session ? session.role : localRole;
  const changeRole = (r: Role) => {
    setLocalRole(r);
    localStorage.setItem('openpos.role', r);
  };

  const f = config.features;
  const canManage = role !== 'cashier';
  const tabs: [Tab, string, boolean][] = [
    ['pos', t('nav.sell'), true],
    ['products', t('nav.products'), true],
    ['purchases', t('nav.purchases'), f.purchases && canManage],
    ['transfers', t('nav.transfers'), f.transfers && canManage],
    ['sales', t('nav.sales'), f.sales],
    ['reports', t('nav.reports'), f.reports],
    ['settings', t('nav.settings'), true],
  ];

  const syncLabel = !serverOn
    ? t('status.localOnly')
    : syncStatus.error
      ? t('status.syncProblem')
      : syncStatus.at
        ? t('status.synced', { time: new Date(syncStatus.at).toLocaleTimeString(config.locale, { hour: '2-digit', minute: '2-digit' }) })
        : t('status.notSynced');

  return (
    <div className="app">
      {!isSecure() && <div className="banner" role="alert"><strong>Not a secure address.</strong> {INSECURE_MESSAGE}</div>}
      <header className="top">
        <div className="brand">
          <strong>{config.appName}</strong>
          <span className="muted small">{config.tagline}</span>
        </div>
        <div className="status">
          {shopName && <span className="pill" title="The shop this device sells for">{shopName}</span>}
          <span className={`pill ${online ? 'ok' : 'warn'}`}>{online ? t('status.online') : t('status.offline')}</span>
          <span className={`pill ${syncStatus.error ? 'warn' : ''}`} title={syncStatus.error || 'Changes waiting to reach the server'}>
            {syncLabel} · {t('status.waiting', { n: queued })}
          </span>
          {session ? (
            <>
              {session.businessName && session.isSuper !== undefined && <span className="pill" title="Business">{session.businessName}</span>}
              <span className="pill" title="Signed-in account">{session.username} ({session.role})</span>
              <button onClick={logout}>{t('status.signOut')}</button>
            </>
          ) : (
            <select value={role} onChange={(e) => changeRole(e.target.value as Role)} aria-label="Role">
              <option value="cashier">Cashier</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          )}
        </div>
      </header>

      <nav className="tabs">
        {tabs
          .filter(([, , show]) => show)
          .map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
      </nav>

      <main>
        {tab === 'pos' && <Pos />}
        {tab === 'products' && <Products canManage={canManage} />}
        {tab === 'purchases' && canManage && <Purchases />}
        {tab === 'transfers' && canManage && <Transfers />}
        {tab === 'sales' && <Sales canManage={canManage} />}
        {tab === 'reports' && <Reports />}
        {tab === 'settings' && <Settings canManage={canManage} isAdmin={role === 'admin'} onChange={() => force((n) => n + 1)} />}
      </main>

      {f.voice && <VoiceDock role={role} />}
    </div>
  );
}
