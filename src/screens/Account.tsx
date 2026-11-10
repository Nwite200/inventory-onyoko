import { useState } from 'react';
import { changePassword } from '../auth';

/** "Change my password" for whoever is signed in (cashiers included). Other devices are signed out. */
export function Account() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    setOk(false);
    if (next !== again) return setMsg('The two new passwords are different.');
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setAgain('');
      setOk(true);
      setMsg('Password changed. Any other device you were signed in on must sign in again.');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not change the password');
    }
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h3>Change my password</h3>
      <input type="password" placeholder="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      <input type="password" placeholder="New password (8+ characters)" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
      <input type="password" placeholder="New password again" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
      <button className="primary">Change password</button>
      {msg && <p className={ok ? 'muted' : 'error'}>{msg}</p>}
    </form>
  );
}
