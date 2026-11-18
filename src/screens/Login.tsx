import { useEffect, useState } from 'react';
import { config, saveConfig } from '../config';
import { authStatus, login, serverBase, setupAdmin } from '../auth';
import { t } from '../i18n';

export function Login({ onServerChange }: { onServerChange: () => void }) {
  const [server, setServer] = useState(config.serverUrl);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setNeedsSetup(null);
    authStatus()
      .then((s) => {
        if (live) {
          setNeedsSetup(s.needsSetup);
          setError('');
        }
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Cannot reach the server'));
    return () => {
      live = false;
    };
  }, [server]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (needsSetup) await setupAdmin(username, password);
      else await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  const applyServer = () => {
    saveConfig({ serverUrl: server.trim() });
    onServerChange();
  };

  return (
    <div className="login">
      <form className="card form" onSubmit={submit}>
        <div className="login-brand">
          {config.branding.loginLogo || config.branding.logo ? (
            <img className="login-logo" src={config.branding.loginLogo || config.branding.logo} alt="" />
          ) : (
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 28 28"><circle cx="13" cy="15" r="6.4" fill="none" stroke="currentColor" strokeWidth="3" /><circle cx="21" cy="7" r="2.6" fill="currentColor" /></svg>
            </span>
          )}
          <span>
            <strong>{config.appName}</strong>
            <small>{config.branding.businessName || config.tagline}</small>
          </span>
        </div>
        <h2>{needsSetup ? 'Create the owner account' : 'Welcome back'}</h2>
        <p className="muted small">{needsSetup ? t('login.firstTime') : t('login.signInToContinue')}</p>
        <label>
          {t('login.username')}
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label>
          {t('login.password')} {needsSetup && <span className="small">{t('login.atLeast8')}</span>}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={needsSetup ? 'new-password' : 'current-password'} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary big" disabled={busy || needsSetup === null}>
          {needsSetup ? t('login.create') : t('login.signIn')}
        </button>
        <details>
          <summary className="small muted">{t('login.server')}</summary>
          <div className="form">
            <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="http://192.168.1.10:8787" />
            <div className="row-btns">
              <button type="button" onClick={applyServer} disabled={server.trim() === serverBase()}>{t('login.useServer')}</button>
              <button type="button" onClick={() => setServer(window.location.origin)}>{t('login.thisWebsite')}</button>
              <button type="button" className="danger" onClick={() => { setServer(''); saveConfig({ serverUrl: '' }); onServerChange(); }}>
                {t('login.noServer')}
              </button>
            </div>
          </div>
        </details>
      </form>
    </div>
  );
}
