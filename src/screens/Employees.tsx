import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { addEmployee } from '../financeOps';
import { Icon } from '../components/Icon';

export function Employees() {
  const employees = useLiveQuery(() => db.employees.toArray(), [], []);
  const [form, setForm] = useState({ name: '', role: 'Staff', salary: '', tax: '7.5', pension: '8', phone: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="employees-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">People</span>
          <h1>Employees</h1>
          <p className="lede">Staff records used by payroll and shift accountability. Login accounts are managed separately under Settings → Users.</p>
        </div>
      </header>
      {err && <div className="alert-error">{err}</div>}
      {msg && <div className="alert-success">{msg}</div>}
      <section className="advanced-grid">
        <article className="panel">
          <header className="panel-head"><div><h3>Add an employee</h3><p className="panel-sub">Gross salary and statutory rates</p></div></header>
          <form className="panel-body form" onSubmit={async (e) => {
            e.preventDefault();
            setErr(''); setMsg('');
            try {
              await addEmployee({ name: form.name, role: form.role, salary: Number(form.salary), taxRate: Number(form.tax), pensionRate: Number(form.pension), phone: form.phone });
              setForm({ name: '', role: 'Staff', salary: '', tax: '7.5', pension: '8', phone: '' });
              setMsg('Employee added.');
            } catch (error) {
              setErr(error instanceof Error ? error.message : 'Could not add the employee');
            }
          }}>
            <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <div className="form-grid two-col">
              <label className="field"><span>Role</span><input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></label>
              <label className="field"><span>Phone</span><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              <label className="field"><span>Monthly gross</span><input type="number" min="0" step="any" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} required /></label>
              <label className="field"><span>PAYE %</span><input type="number" min="0" max="100" step="any" value={form.tax} onChange={(e) => setForm({ ...form, tax: e.target.value })} /></label>
              <label className="field"><span>Pension %</span><input type="number" min="0" max="100" step="any" value={form.pension} onChange={(e) => setForm({ ...form, pension: e.target.value })} /></label>
            </div>
            <button className="btn btn-primary"><Icon name="plus" size={15} /> Add employee</button>
          </form>
        </article>
        <article className="panel">
          <header className="panel-head"><div><h3>Staff directory</h3><p className="panel-sub">{employees.filter((e) => e.active).length} active</p></div></header>
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Name</th><th>Role</th><th className="num">Gross</th><th>Status</th></tr></thead><tbody>
            {employees.map((e) => <tr key={e.id}><td><strong>{e.name}</strong><div className="muted small">{e.phone || 'No phone'}</div></td><td>{e.role}</td><td className="num">{e.salary.toLocaleString()}</td><td><span className={`badge ${e.active ? 'badge-success' : 'badge-subtle'}`}>{e.active ? 'Active' : 'Inactive'}</span></td></tr>)}
            {employees.length === 0 && <tr><td colSpan={4} className="empty-table-cell">No employees yet.</td></tr>}
          </tbody></table></div>
        </article>
      </section>
    </div>
  );
}
