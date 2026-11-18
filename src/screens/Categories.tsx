import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid } from '../db';
import { queueAdvanced } from '../advanced';
import { Icon } from '../components/Icon';

export function Categories() {
  const products = useLiveQuery(() => db.products.toArray(), [], []);
  const stored = useLiveQuery(() => db.categories.toArray(), [], []);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const rows = useMemo(() => {
    const names = new Set<string>([...stored.map((c) => c.name), ...products.map((p) => p.category).filter(Boolean) as string[]]);
    return [...names].sort((a, b) => a.localeCompare(b)).map((n) => ({
      id: stored.find((c) => c.name === n)?.id,
      name: n,
      count: products.filter((p) => p.category === n).length,
      value: products.filter((p) => p.category === n).reduce((s, p) => s + Math.max(0, p.stock) * p.price, 0),
    }));
  }, [products, stored]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    const n = name.trim();
    if (!n) return;
    if (rows.some((r) => r.name.toLowerCase() === n.toLowerCase())) {
      setErr('That category already exists.');
      return;
    }
    const record = { id: uid(), name: n };
    await db.transaction('rw', [db.categories, db.outbox], async () => {
      await db.categories.add(record);
      await queueAdvanced('categories', record);
    });
    setName('');
    setMsg('Category added. Assign it from the product editor.');
  };

  const rename = async (oldName: string) => {
    const next = window.prompt(`Rename "${oldName}" to:`, oldName)?.trim();
    if (!next || next === oldName) return;
    setErr('');
    setMsg('');
    if (rows.some((r) => r.name.toLowerCase() === next.toLowerCase())) {
      setErr('Another category already uses that name.');
      return;
    }
    await db.transaction('rw', [db.products, db.categories, db.outbox], async () => {
      for (const p of await db.products.toArray()) {
        if (p.category === oldName) await db.products.put({ ...p, category: next, updatedAt: Date.now() });
      }
      const existing = (await db.categories.toArray()).find((c) => c.name === oldName);
      const record = { id: existing?.id ?? uid(), name: next };
      await db.categories.put(record);
      await queueAdvanced('categories', record);
    });
    setMsg('Category renamed on every product.');
  };

  const remove = async (row: { name: string; count: number; id?: string }) => {
    setErr('');
    setMsg('');
    if (row.count > 0) {
      setErr(`"${row.name}" is used by ${row.count} product${row.count === 1 ? '' : 's'}. Move them first.`);
      return;
    }
    if (!confirm(`Delete category "${row.name}"?`)) return;
    await db.transaction('rw', [db.categories, db.outbox], async () => {
      if (row.id) await db.categories.delete(row.id);
      await db.outbox.add({ entity: 'advanced', op: 'delete', payload: { table: 'categories', record: { id: row.id ?? row.name } }, at: Date.now() });
    });
    setMsg('Category removed.');
  };

  return (
    <div className="categories-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Catalogue</span>
          <h1>Categories</h1>
          <p className="lede">Organise the catalogue, power POS filters and category reporting.</p>
        </div>
      </header>
      {err && <div className="alert-error">{err}</div>}
      {msg && <div className="alert-success">{msg}</div>}
      <section className="advanced-grid">
        <article className="panel">
          <header className="panel-head"><div><h3>Add a category</h3><p className="panel-sub">{rows.length} categories in use</p></div></header>
          <form className="panel-body form" onSubmit={add}>
            <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Beverages" required /></label>
            <button className="btn btn-primary"><Icon name="plus" size={15} /> Add category</button>
            <p className="panel-sub">Products can still use a free-text category; this list supplies suggestions and management.</p>
          </form>
        </article>
        <article className="panel">
          <header className="panel-head"><div><h3>Category directory</h3><p className="panel-sub">Retail value shown at selling price</p></div></header>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Category</th><th className="num">Products</th><th className="num">Retail value</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td><strong>{r.name}</strong></td>
                    <td className="num">{r.count}</td>
                    <td className="num">{r.value.toLocaleString()}</td>
                    <td className="num"><div className="row-actions end"><button className="btn btn-ghost btn-sm" onClick={() => void rename(r.name)}>Rename</button><button className="btn btn-ghost btn-sm danger-hover" onClick={() => void remove(r)}>Delete</button></div></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={4} className="empty-table-cell">No categories yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </div>
  );
}
