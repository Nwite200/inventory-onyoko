import { useCallback, useEffect, useState } from 'react';
import { getSession } from '../auth';

interface UserRow {
  username: string;
  role: string;
  disabled: number;
}

type Call = <T>(method: 'GET' | 'POST', path: string, body?: unknown) => Promise<T>;

export function Users({ call }: { call: Call }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('cashier');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    call<{ users: UserRow[] }>('GET', '/api/users')
      .then((r) => setUsers(r.users))
      .catch((e: unknown) => setMsg(e instanceof Error ? e.message : 'Could not load users'));
  }, [call]);
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    try {
      await call('POST', '/api/users', { username, password, role });
      setUsername('');
      setPassword('');
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not create user');
    }
  };

  const toggle = async (u: UserRow) => {
    setMsg('');
    try {
      await call('POST', '/api/users/disable', { username: u.username, disabled: !u.disabled });
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not update user');
    }
  };

  const reset = async (u: UserRow) => {
    const pw = window.prompt(`New password for ${u.username} (8+ characters). Tell them privately; they should change it after signing in.`);
    if (pw === null) return;
    setMsg('');
    try {
      await call('POST', '/api/users/password', { username: u.username, newPassword: pw });
      setMsg(`Password for ${u.username} was reset. Their other devices are signed out.`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not reset the password');
    }
  };
  const me = getSession()?.username;

  return (
    <div className="card form">
      <h3>Staff accounts</h3>
      {users.map((u) => (
        <div className="row" key={u.username}>
          <span>
            {u.username} <span className="small muted">({u.role})</span>
            {u.disabled ? <span className="pill warn">disabled</span> : null}
          </span>
          <span className="row-btns">
            {u.username !== me && <button onClick={() => void reset(u)}>Reset password</button>}
            <button onClick={() => void toggle(u)}>{u.disabled ? 'Enable' : 'Disable'}</button>
          </span>
        </div>
      ))}
      <form className="form" onSubmit={add}>
        <input placeholder="New username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <input placeholder="Password (8+ characters)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="cashier">Cashier</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
        <button className="primary">Add account</button>
      </form>
      {msg && <p className="error">{msg}</p>}
    </div>
  );
}
