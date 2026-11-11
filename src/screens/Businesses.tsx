import { useCallback, useEffect, useState } from 'react';
import { t } from '../i18n';

interface BusinessRow {
  id: string;
  name: string;
  users: number;
}

type Call = <T>(method: 'GET' | 'POST', path: string, body?: unknown) => Promise<T>;

/** For the server owner: open separate businesses, each with its own people and data. */
export function Businesses({ call }: { call: Call }) {
  const [rows, setRows] = useState<BusinessRow[]>([]);
  const [name, setName] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    call<{ businesses: BusinessRow[] }>('GET', '/api/businesses')
      .then((r) => setRows(r.businesses))
      .catch((e: unknown) => setMsg(e instanceof Error ? e.message : 'Could not load businesses'));
  }, [call]);
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    try {
      await call('POST', '/api/businesses', { name, adminUsername, adminPassword });
      setMsg(t('biz.created', { name }));
      setName('');
      setAdminUsername('');
      setAdminPassword('');
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not create the business');
    }
  };

  return (
    <div className="card">
      <h3>{t('biz.title')}</h3>
      <p className="small muted">{t('biz.help')}</p>
      {rows.map((b) => (
        <div className="row" key={b.id}>
          <span>{b.name}</span>
          <span className="muted small">{t('biz.people', { n: b.users })}</span>
        </div>
      ))}
      <form className="form" onSubmit={add}>
        <input placeholder={t('biz.name')} value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder={t('biz.adminUser')} value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} autoComplete="off" required />
        <input placeholder={t('biz.adminPass')} type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} autoComplete="new-password" required />
        <button className="primary">{t('biz.add')}</button>
      </form>
      {msg && <p className="small" role="status">{msg}</p>}
    </div>
  );
}
