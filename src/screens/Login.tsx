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
        <h2>{config.appName}</h2>
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
