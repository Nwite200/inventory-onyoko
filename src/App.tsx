import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { config } from './config';
import { AUTH_EVENT, getSession, logout, refreshPolicy, serverMode } from './auth';
import { SYNC_EVENT, syncStatus } from './sync';
import type { Role } from './voice/agent';
import { Home } from './screens/Home';
import { Pos } from './screens/Pos';
import { Products } from './screens/Products';
import { Sales } from './screens/Sales';
import { Returns } from './screens/Returns';
import { Purchases } from './screens/Purchases';
import { InventoryHub } from './screens/InventoryHub';
import { Contacts } from './screens/Contacts';
import { Expenses } from './screens/Expenses';
import { CashRegisterScreen } from './screens/CashRegister';
import { Reports } from './screens/Reports';
import { Accounting } from './screens/Accounting';
import { Advanced } from './screens/Advanced';
import { Platform } from './screens/Platform';
import { Categories } from './screens/Categories';
import { Quotations } from './screens/Quotations';
import { Branches } from './screens/Branches';
import { Employees } from './screens/Employees';
import { Branding } from './screens/Branding';
import { Transfers } from './screens/Transfers';
import { Settings } from './screens/Settings';
import { VoiceDock } from './screens/VoiceDock';
import { Login } from './screens/Login';
import { INSECURE_MESSAGE, isSecure } from './secure';
import { currentLocationId, listLocations, setCurrentLocation } from './location';
import { t } from './i18n';
import { Icon, type IconName } from './components/Icon';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NAV_CATALOG, NAV_GROUPS } from './navigation';

type Tab = string;

interface NavItem {
  id: Tab;
  label: string;
  icon: IconName;
  group: string;
  managerOnly?: boolean;
  superOnly?: boolean;
  show: boolean;
}

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

function useEvents(...names: string[]): void {
  const [, bump] = useState(0);
  const key = names.join('|');
  useEffect(() => {
    const h = () => bump((n) => n + 1);
    const list = key.split('|').filter(Boolean);
    list.forEach((n) => window.addEventListener(n, h));
    return () => list.forEach((n) => window.removeEventListener(n, h));
  }, [key]);
}

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('openpos.theme') as 'light' | 'dark') || 'light');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('openpos.theme', theme);
  }, [theme]);
  return { theme, toggle: () => setTheme((p) => (p === 'light' ? 'dark' : 'light')) };
}

const initials = (name: string): string =>
  name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || 'OP';

export function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [locationTick, setLocationTick] = useState(0);
  const { theme, toggle: toggleTheme } = useTheme();

  const [localRole, setLocalRole] = useState<Role>(() => (localStorage.getItem('openpos.role') as Role) || 'admin');
  const [, force] = useState(0);
  const online = useOnline();
  const queued = useLiveQuery(() => db.outbox.count(), [], 0);
  const locations = useLiveQuery(() => listLocations(), [], []);
  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), [], []);
  const [shop, setShop] = useState<string>(() => currentLocationId());

  const activeRegister = useLiveQuery(() => db.registers.where('status').equals('open').first(), [locationTick]);
  const alerts = useLiveQuery(async () => {
    const [all, lots] = await Promise.all([db.products.toArray(), db.lots.toArray()]);
    const soon = Date.now() + 30 * 86_400_000;
    return {
      low: all.filter((p) => p.stock > 0 && p.stock <= p.lowStockAt).length,
      out: all.filter((p) => p.stock <= 0).length,
      expiring: lots.filter((l) => l.expiresAt < soon).length,
    };
  }, [locationTick], { low: 0, out: 0, expiring: 0 });

  useEvents(AUTH_EVENT, SYNC_EVENT);

  useEffect(() => {
    if (serverMode() && getSession()) void refreshPolicy();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        setNotifyOpen(false);
        setProfileOpen(false);
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const serverOn = serverMode();
  const session = serverOn ? getSession() : null;

  if (serverOn && !session) return <Login onServerChange={() => force((n) => n + 1)} />;

  const role: Role = session ? session.role : localRole;
  const changeRole = (r: Role) => {
    setLocalRole(r);
    localStorage.setItem('openpos.role', r);
  };
  const canManage = role !== 'cashier';
  const pendingCount = serverOn ? queued : 0;
  const alertCount = alerts.low + alerts.out + alerts.expiring + (pendingCount > 0 ? 1 : 0) + (syncStatus.error ? 1 : 0);

  const navSections: { label: string; items: NavItem[] }[] = NAV_GROUPS.map((label) => {
    const order = config.navigation.order;
    const rank = (id: string): number => { const i = order.indexOf(id); return i === -1 ? 9999 : i; };
    const items = NAV_CATALOG
      .filter((n) => n.group === label)
      .filter((n) => (!n.managerOnly || canManage) && (!n.superOnly || Boolean(session?.isSuper)))
      .filter((n) => n.id === 'settings' || !config.navigation.hidden.includes(n.id))
      .sort((a, b) => rank(a.id) - rank(b.id) || NAV_CATALOG.indexOf(a) - NAV_CATALOG.indexOf(b))
      .map((n) => ({ ...n, show: true }));
    return { label, items };
  }).filter((s) => s.items.length > 0);

  const flatNav = navSections.flatMap((s) => s.items);

  const navigate = (next: string) => {
    setTab(next as Tab);
    setMobileMenuOpen(false);
    setPaletteOpen(false);
    setNotifyOpen(false);
    setProfileOpen(false);
  };

  const syncLabel = !serverOn
    ? t('status.localOnly')
    : syncStatus.error
      ? t('status.syncProblem')
      : syncStatus.at
        ? t('status.synced', { time: new Date(syncStatus.at).toLocaleTimeString(config.locale, { hour: '2-digit', minute: '2-digit' }) })
        : t('status.notSynced');

  const paletteResults = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    const pages = flatNav.filter((n) => !q || n.label.toLowerCase().includes(q)).slice(0, q ? 6 : 8).map((n) => ({ kind: 'page' as const, id: n.id, label: n.label, icon: n.icon, hint: 'Go to' }));
    const hits = q
      ? products.filter((p) => (p.name + ' ' + p.sku).toLowerCase().includes(q)).slice(0, 6).map((p) => ({ kind: 'product' as const, id: p.id, label: p.name, icon: 'products' as IconName, hint: `${p.stock} ${p.unit} · ${p.sku || 'no barcode'}` }))
      : [];
    return [...pages, ...hits];
  }, [paletteQuery, products, flatNav]);

  const changeShop = async (id: string) => {
    setShop(id);
    await setCurrentLocation(id);
    setLocationTick((n) => n + 1);
    window.dispatchEvent(new Event(SYNC_EVENT));
  };

  const notifications: { id: string; title: string; detail: string; tone: 'warn' | 'danger' | 'info'; go: Tab }[] = [
    ...(syncStatus.error ? [{ id: 'sync', title: 'Sync problem', detail: syncStatus.error, tone: 'danger' as const, go: 'settings' as Tab }] : []),
    ...(pendingCount > 0 ? [{ id: 'queue', title: `${pendingCount} change${pendingCount === 1 ? '' : 's'} waiting`, detail: 'Saved on this device and queued for sync.', tone: 'info' as const, go: 'settings' as Tab }] : []),
    ...(alerts.out > 0 ? [{ id: 'out', title: `${alerts.out} product${alerts.out === 1 ? '' : 's'} out of stock`, detail: 'Reorder before the next rush.', tone: 'danger' as const, go: 'inventory' as Tab }] : []),
    ...(alerts.low > 0 ? [{ id: 'low', title: `${alerts.low} running low`, detail: 'Stock is at or below the reorder level.', tone: 'warn' as const, go: 'inventory' as Tab }] : []),
    ...(alerts.expiring > 0 ? [{ id: 'exp', title: `${alerts.expiring} batch${alerts.expiring === 1 ? '' : 'es'} expiring`, detail: 'Expired or expiring within 30 days.', tone: 'warn' as const, go: 'inventory' as Tab }] : []),
    ...(!activeRegister ? [{ id: 'register', title: 'Till is closed', detail: 'Open the register before taking cash.', tone: 'info' as const, go: 'register' as Tab }] : []),
  ];

  return (
    <div className="app-shell">
      {mobileMenuOpen && <button className="sidebar-scrim" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu" />}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <button className="brand" onClick={() => navigate('home')} title={config.appName}>
            {config.branding.logo ? (
              <img className="brand-logo" src={config.branding.logo} alt="" />
            ) : (
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 28 28"><circle cx="13" cy="15" r="6.4" fill="none" stroke="currentColor" strokeWidth="3" /><circle cx="21" cy="7" r="2.6" fill="currentColor" /></svg>
              </span>
            )}
            {!sidebarCollapsed && (
              <span className="brand-text">
                <strong>{config.appName}</strong>
                <small>{config.branding.businessName || 'Business OS'}</small>
              </span>
            )}
          </button>
          <button className="toggle-sidebar-btn desktop-only" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} title="Toggle sidebar" aria-label="Toggle sidebar">
            <Icon name={sidebarCollapsed ? 'chevronRight' : 'chevronLeft'} size={15} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {navSections.map((sec) => {
            const items = sec.items.filter((i) => i.show);
            if (!items.length) return null;
            return (
              <div className="nav-group" key={sec.label}>
                {!sidebarCollapsed && <div className="nav-group-label">{sec.label}</div>}
                {items.map((item) => (
                  <button
                    key={item.id}
                    className={`nav-item ${tab === item.id ? 'active' : ''}`}
                    onClick={() => navigate(item.id)}
                    title={item.label}
                  >
                    <span className="nav-icon"><Icon name={item.icon} size={18} /></span>
                    {!sidebarCollapsed && <span className="nav-text">{item.label}</span>}
                    {!sidebarCollapsed && tab === item.id && <span className="nav-active-dot" />}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          {locations.length > 1 && !sidebarCollapsed && (
            <label className="sidebar-branch">
              <span><Icon name="store" size={14} /> Branch</span>
              <select value={shop} onChange={(e) => void changeShop(e.target.value)} aria-label="Current branch">
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          )}
          <button className={`till-chip ${activeRegister ? 'open' : ''}`} onClick={() => navigate('register')}>
            <span className="dot" />
            {activeRegister ? 'Till open' : 'Till closed'}
          </button>
          {!sidebarCollapsed && (
            <button className="sidebar-user" onClick={() => navigate('settings')}>
              <span className="avatar">{initials(session?.username ?? 'Local operator')}</span>
              <span className="sidebar-user-info">
                <strong>{session?.username ?? 'Local operator'}</strong>
                <small>{role}</small>
              </span>
            </button>
          )}
        </div>
      </aside>

      <div className="main-wrapper">
        {!isSecure() && (
          <div className="banner" role="alert">
            <Icon name="alert" size={15} /> <strong>Not a secure address.</strong> {INSECURE_MESSAGE}
          </div>
        )}

        <header className="top-navbar">
          <div className="navbar-left">
            <button className="icon-btn mobile-only" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu">
              <Icon name="menu" size={20} />
            </button>
            <button className="search-trigger" onClick={() => setPaletteOpen(true)}>
              <Icon name="search" size={16} />
              <span>Search products, pages…</span>
              <span className="kbd">⌘K</span>
            </button>
          </div>

          <div className="navbar-right">
            {locations.length > 1 && (
              <label className="topbar-branch">
                <Icon name="store" size={14} />
                <select value={shop} onChange={(e) => void changeShop(e.target.value)} aria-label="Branch">
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
            )}
            <span className={`sync-chip ${syncStatus.error ? 'error' : !serverOn ? 'local' : online ? 'online' : 'offline'}`} title={syncStatus.error || syncLabel}>
              <span className="dot" />
              {!online ? 'Offline' : syncStatus.error ? 'Sync issue' : pendingCount > 0 ? `${pendingCount} queued` : syncLabel}
            </span>

            <div className="popover-wrap">
              <button className="icon-btn" onClick={() => { setNotifyOpen((o) => !o); setProfileOpen(false); }} aria-label="Notifications" aria-expanded={notifyOpen}>
                <Icon name="bell" size={18} />
                {alertCount > 0 && <span className="notify-count">{alertCount > 9 ? '9+' : alertCount}</span>}
              </button>
              {notifyOpen && (
                <>
                  <button className="popover-scrim" onClick={() => setNotifyOpen(false)} aria-label="Close notifications" />
                  <div className="popover notify-panel">
                    <header className="popover-head">
                      <strong>Notifications</strong>
                      <span className="badge badge-subtle">{alertCount} active</span>
                    </header>
                    {notifications.length === 0 ? (
                      <div className="empty-state compact"><p>Everything looks clear.</p></div>
                    ) : (
                      <ul className="notify-list">
                        {notifications.map((n) => (
                          <li key={n.id}>
                            <button onClick={() => navigate(n.go)}>
                              <span className={`notify-dot ${n.tone}`} />
                              <span className="notify-body"><strong>{n.title}</strong><small>{n.detail}</small></span>
                              <Icon name="chevronRight" size={14} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>

            <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle light / dark">
              <Icon name={theme === 'light' ? 'moon' : 'sun'} size={18} />
            </button>

            {config.features.voice && (
              <button className="icon-btn voice-trigger" onClick={() => window.dispatchEvent(new Event('openpos-voice'))} aria-label="Open voice assistant" title="Voice assistant">
                <Icon name="mic" size={18} />
              </button>
            )}

            <button className="icon-btn" onClick={() => navigate('settings')} aria-label="Settings" title="Settings">
              <Icon name="settings" size={18} />
            </button>

            <div className="popover-wrap">
              <button className="profile-trigger" onClick={() => { setProfileOpen((o) => !o); setNotifyOpen(false); }} aria-expanded={profileOpen}>
                <span className="avatar">{initials(session?.username ?? localRole)}</span>
                <span className="profile-meta">
                  <strong>{session?.username ?? 'Local mode'}</strong>
                  <small>{role}</small>
                </span>
                <Icon name="chevronDown" size={14} />
              </button>
              {profileOpen && (
                <>
                  <button className="popover-scrim" onClick={() => setProfileOpen(false)} aria-label="Close account menu" />
                  <div className="popover profile-panel">
                    <div className="profile-head">
                      <span className="avatar lg">{initials(session?.username ?? localRole)}</span>
                      <div>
                        <strong>{session?.username ?? 'Local operator'}</strong>
                        <small>{session?.businessName ?? (serverOn ? 'Signed in' : 'No server — this device only')}</small>
                      </div>
                    </div>
                    <button onClick={() => navigate('settings')}><Icon name="settings" size={15} /> Settings</button>
                    {canManage && <button onClick={() => navigate('branding')}><Icon name="palette" size={15} /> Branding &amp; receipts</button>}
                    {!session ? (
                      <div className="role-switch">
                        <span>Preview as</span>
                        <select value={role} onChange={(e) => changeRole(e.target.value as Role)} aria-label="Role">
                          <option value="cashier">Cashier</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                    ) : (
                      <button onClick={logout}><Icon name="logout" size={15} /> Sign out</button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="page-content" key={`${tab}:${locationTick}`}>
          <ErrorBoundary key={`${tab}:${locationTick}`} onReset={() => navigate('home')}>
          {tab === 'home' && <Home onNavigate={navigate} canManage={canManage} />}
          {tab === 'pos' && <Pos />}
          {tab === 'sales' && <Sales canManage={canManage} onNavigate={navigate} />}
          {tab === 'quotations' && <Quotations />}
          {tab === 'returns' && <Returns />}
          {tab === 'products' && <Products canManage={canManage} />}
          {tab === 'categories' && <Categories />}
          {tab === 'purchases' && canManage && <Purchases />}
          {tab === 'inventory' && <InventoryHub />}
          {tab === 'warehouses' && canManage && <Advanced initialTab="warehouse" />}
          {tab === 'transfers' && <div><header className="page-head"><div><span className="eyebrow">Stock movement</span><h1>Transfers</h1><p className="lede">Move goods between branches; the receiving branch confirms arrival before stock is added.</p></div></header><Transfers /></div>}
          {tab === 'contacts' && <Contacts />}
          {tab === 'expenses' && canManage && <Expenses />}
          {tab === 'accounting' && canManage && <Accounting canManage={canManage} />}
          {tab === 'banking' && canManage && <Advanced initialTab="banking" />}
          {tab === 'advanced' && canManage && <Advanced />}
          {tab === 'employees' && canManage && <Employees />}
          {tab === 'branches' && <Branches isAdmin={role === 'admin'} />}
          {tab === 'branding' && canManage && <Branding onChange={() => force((n) => n + 1)} />}
          {tab === 'platform' && session?.isSuper && <Platform />}
          {tab === 'register' && <CashRegisterScreen />}
          {tab === 'reports' && <Reports canManage={canManage} />}
          {tab === 'settings' && <Settings canManage={canManage} isAdmin={role === 'admin'} onChange={() => force((n) => n + 1)} />}
          </ErrorBoundary>
        </main>

        <nav className="mobile-nav" aria-label="Primary">
          {([
            ['home', 'Home', 'dashboard'],
            ['pos', 'Sell', 'pos'],
            ['inventory', 'Stock', 'inventory'],
            ['reports', 'Reports', 'clipboard'],
          ] as [Tab, string, IconName][]).map(([id, label, icon]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => navigate(id)}>
              <Icon name={icon} size={20} />
              <span>{label}</span>
            </button>
          ))}
          <button onClick={() => setMobileMenuOpen(true)} className={!['home', 'pos', 'inventory', 'reports'].includes(tab) ? 'active' : ''}>
            <Icon name="more" size={20} />
            <span>More</span>
          </button>
        </nav>

        {config.features.voice && tab !== 'pos' && <VoiceDock role={role} />}
      </div>

      {paletteOpen && (
        <div className="modal-backdrop palette-backdrop" onClick={() => setPaletteOpen(false)}>
          <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Search">
            <div className="palette-input">
              <Icon name="search" size={18} />
              <input
                autoFocus
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && paletteResults[0]) navigate(paletteResults[0].id);
                }}
                placeholder="Jump to a page or find a product…"
                aria-label="Search"
              />
              <span className="kbd">esc</span>
            </div>
            <div className="palette-results">
              {paletteResults.length === 0 ? (
                <p className="empty-notice">No matches.</p>
              ) : (
                paletteResults.map((r) => (
                  <button key={`${r.kind}-${r.id}`} onClick={() => navigate(r.kind === 'product' ? 'products' : r.id)}>
                    <span className="palette-ico"><Icon name={r.icon} size={16} /></span>
                    <span className="palette-label">{r.label}</span>
                    <span className="palette-hint">{r.kind === 'product' ? r.hint : 'Page'}</span>
                    <Icon name="arrowRight" size={14} />
                  </button>
                ))
              )}
            </div>
            <footer className="palette-foot">
              <span><span className="kbd">↑</span><span className="kbd">↓</span> navigate</span>
              <span><span className="kbd">↵</span> open</span>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
