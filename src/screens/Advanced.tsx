import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type Approval } from '../db';
import { config, formatMoney, saveConfig } from '../config';
import { Icon, type IconName } from '../components/Icon';
import {
  addBin, addSerial, binStock, binnedQty, completePickTask, completeProductionOrder,
  createPickTask, createProductionOrder, putAway, releaseFromBin, saveBom, setSerialStatus,
} from '../operations';
import {
  accumulatedDepreciation, addAsset, addBankAccount, addBankTransaction, addEmployee, budgetVariance,
  monthlyDepreciation, payPayslip, payrollFigures, postDepreciation, reconcile, runPayroll, saveBudget,
  saveCurrency, toggleBankTransaction,
} from '../financeOps';
import { accountBalances, CHART_OF_ACCOUNTS, loadLedger } from '../accounting';
import { decideApproval } from '../approvals';
import { queueAdvanced } from '../advanced';
import { getSession } from '../auth';
import type { FixedAsset } from '../db';

type Tab = 'warehouse' | 'serials' | 'production' | 'assets' | 'budgets' | 'payroll' | 'currencies' | 'taxes' | 'banking' | 'approvals';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'warehouse', label: 'Warehouse', icon: 'inventory' },
  { id: 'serials', label: 'Serial numbers', icon: 'barcode' },
  { id: 'production', label: 'Manufacturing', icon: 'package' },
  { id: 'assets', label: 'Fixed assets', icon: 'store' },
  { id: 'budgets', label: 'Budgets', icon: 'chart' },
  { id: 'payroll', label: 'Payroll', icon: 'users' },
  { id: 'currencies', label: 'Currencies', icon: 'banknote' },
  { id: 'taxes', label: 'Tax rules', icon: 'receipt' },
  { id: 'banking', label: 'Bank reconciliation', icon: 'wallet' },
  { id: 'approvals', label: 'Approvals', icon: 'check' },
];

const money = (n: number): string => formatMoney(Math.round(n * 100) / 100);

function useRunner() {
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setMsg('');
    setErr('');
    try {
      await fn();
      setMsg(done);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong');
    }
  };
  return { run, msg, err, setErr, setMsg };
}

export function Advanced({ initialTab = 'warehouse' }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="advanced-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Operations suite</span>
          <h1>Advanced</h1>
          <p className="lede">Warehouse bins, serials, manufacturing, assets, budgets, payroll, tax, currencies and bank reconciliation.</p>
        </div>
      </header>
      <div className="subtabs-bar advanced-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'subtab active' : 'subtab'} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={15} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'warehouse' && <WarehouseTab />}
      {tab === 'serials' && <SerialsTab />}
      {tab === 'production' && <ProductionTab />}
      {tab === 'assets' && <AssetsTab />}
      {tab === 'budgets' && <BudgetsTab />}
      {tab === 'payroll' && <PayrollTab />}
      {tab === 'currencies' && <CurrenciesTab />}
      {tab === 'taxes' && <TaxesTab />}
      {tab === 'banking' && <BankingTab />}
      {tab === 'approvals' && <ApprovalsTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function WarehouseTab() {
  const data = useLiveQuery(async () => {
    const [bins, products, tasks, sales] = await Promise.all([db.bins.toArray(), db.products.orderBy('name').toArray(), db.pickTasks.orderBy('at').reverse().toArray(), db.sales.orderBy('at').reverse().limit(40).toArray()]);
    return { bins, products, tasks, sales, stock: await binStock() };
  }, []);
  const { run, msg, err } = useRunner();
  const [binForm, setBinForm] = useState({ code: '', zone: '', aisle: '', rack: '', shelf: '' });
  const [put, setPut] = useState({ productId: '', binId: '', qty: '' });
  const [saleId, setSaleId] = useState('');

  if (!data) return <p className="muted">Loading…</p>;
  const binned = (productId: string) => binnedQty(data.stock, productId);
  const rows = data.bins.flatMap((b) => {
    const per = data.stock.get(b.id);
    if (!per) return [];
    return [...per.entries()].filter(([, q]) => q > 0).map(([productId, qty]) => ({
      binId: b.id, code: b.code, productId, qty,
      product: data.products.find((p) => p.id === productId)?.name ?? productId,
    }));
  });

  return (
    <>
      <Banner msg={msg} err={err} />
      <div className="policy-note">
        <Icon name="check" size={15} />
        <span><strong>Bin picking is enforced automatically.</strong> Once stock is assigned to a bin, the till must sell those units from a bin. If a bin allocation is stale, use “Release” in the bin stock table.</span>
      </div>
      <section className="advanced-grid">
        <article className="panel">
          <header className="panel-head"><div><h3>Add a bin</h3><p className="panel-sub">Zone / aisle / rack / shelf / bin</p></div></header>
          <form className="panel-body form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await addBin(binForm); setBinForm({ code: '', zone: '', aisle: '', rack: '', shelf: '' }); }, 'Bin added.'); }}>
            <div className="form-grid two-col">
              <label className="field"><span>Bin code *</span><input value={binForm.code} onChange={(e) => setBinForm({ ...binForm, code: e.target.value })} placeholder="A-12-03" required /></label>
              <label className="field"><span>Zone</span><input value={binForm.zone} onChange={(e) => setBinForm({ ...binForm, zone: e.target.value })} placeholder="Dry goods" /></label>
              <label className="field"><span>Aisle</span><input value={binForm.aisle} onChange={(e) => setBinForm({ ...binForm, aisle: e.target.value })} /></label>
              <label className="field"><span>Rack</span><input value={binForm.rack} onChange={(e) => setBinForm({ ...binForm, rack: e.target.value })} /></label>
              <label className="field"><span>Shelf</span><input value={binForm.shelf} onChange={(e) => setBinForm({ ...binForm, shelf: e.target.value })} /></label>
            </div>
            <button className="btn btn-primary"><Icon name="plus" size={15} /> Add bin</button>
          </form>
        </article>

        <article className="panel">
          <header className="panel-head"><div><h3>Put away</h3><p className="panel-sub">Allocate on-hand stock to a bin</p></div></header>
          <form className="panel-body form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await putAway({ productId: put.productId, binId: put.binId, qty: Number(put.qty) }); setPut({ ...put, qty: '' }); }, 'Stock put away.'); }}>
            <label className="field"><span>Product</span>
              <select value={put.productId} onChange={(e) => setPut({ ...put, productId: e.target.value })} required>
                <option value="">Choose product…</option>
                {data.products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.stock} on hand, {p.stock - binned(p.id)} unassigned</option>)}
              </select>
            </label>
            <label className="field"><span>Bin</span>
              <select value={put.binId} onChange={(e) => setPut({ ...put, binId: e.target.value })} required>
                <option value="">Choose bin…</option>
                {data.bins.map((b) => <option key={b.id} value={b.id}>{b.code}{b.zone ? ` · ${b.zone}` : ''}</option>)}
              </select>
            </label>
            <label className="field"><span>Quantity</span><input type="number" min="0" step="any" value={put.qty} onChange={(e) => setPut({ ...put, qty: e.target.value })} required /></label>
            <button className="btn btn-primary">Put away</button>
          </form>
        </article>
      </section>

      <section className="advanced-grid">
        <article className="panel">
          <header className="panel-head"><div><h3>Bin stock</h3><p className="panel-sub">{data.bins.length} bins · {rows.reduce((s, r) => s + r.qty, 0)} units assigned</p></div></header>
          {rows.length === 0 ? <div className="empty-state compact"><p>No stock assigned to bins yet.</p></div> : (
            <div className="table-scroll"><table className="data-table"><thead><tr><th>Bin</th><th>Product</th><th className="num">Quantity</th><th /></tr></thead><tbody>
              {rows.map((r) => <tr key={`${r.binId}-${r.productId}`}><td className="fw-mono">{r.code}</td><td>{r.product}</td><td className="num">{r.qty}</td><td className="num"><button className="btn btn-ghost btn-sm" onClick={() => { const raw = window.prompt(`Release how many ${r.product} from ${r.code}?`, String(r.qty)); if (raw) void run(() => releaseFromBin(r.binId, r.productId, Number(raw)), 'Bin allocation released.'); }}>Release</button></td></tr>)}
            </tbody></table></div>
          )}
        </article>

        <article className="panel">
          <header className="panel-head"><div><h3>Picking</h3><p className="panel-sub">Generate a pick list for a completed sale</p></div></header>
          <form className="panel-body form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await createPickTask(saleId); setSaleId(''); }, 'Pick list created.'); }}>
            <label className="field"><span>Sale</span>
              <select value={saleId} onChange={(e) => setSaleId(e.target.value)} required>
                <option value="">Choose sale…</option>
                {data.sales.filter((s) => s.status === 'completed').map((s) => <option key={s.id} value={s.id}>{s.number} · {s.customerName}</option>)}
              </select>
            </label>
            <button className="btn btn-primary" disabled={!saleId}>Generate pick list</button>
          </form>
          {data.tasks.length > 0 && (
            <ul className="task-list">
              {data.tasks.slice(0, 6).map((t) => (
                <li key={t.id}>
                  <span><strong>{t.number}</strong><small>{t.saleNumber} · {t.items.length} lines · {t.status}</small></span>
                  {t.status === 'pending' && <button className="btn btn-sm" onClick={() => void run(() => completePickTask(t.id), 'Pick completed.')}>Complete</button>}
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function SerialsTab() {
  const [serials, products] = useLiveQuery(async () => Promise.all([db.serials.orderBy('at').reverse().toArray(), db.products.orderBy('name').toArray()]), [], [[], []]);
  const { run, msg, err } = useRunner();
  const [form, setForm] = useState({ productId: '', serial: '', warranty: '', batchNo: '' });
  return (
    <>
      <Banner msg={msg} err={err} />
      <section className="advanced-grid">
        <article className="panel">
          <header className="panel-head"><div><h3>Register a serial</h3><p className="panel-sub">Phone, appliance, device or warranty item</p></div></header>
          <form className="panel-body form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await addSerial({ productId: form.productId, serial: form.serial, warrantyMonths: Number(form.warranty) || undefined, batchNo: form.batchNo }); setForm({ ...form, serial: '', batchNo: '' }); }, 'Serial registered.'); }}>
            <label className="field"><span>Product</span><select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} required><option value="">Choose product…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="field"><span>Serial number</span><input value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} required /></label>
            <div className="form-grid two-col">
              <label className="field"><span>Warranty (months)</span><input type="number" min="0" value={form.warranty} onChange={(e) => setForm({ ...form, warranty: e.target.value })} /></label>
              <label className="field"><span>Batch</span><input value={form.batchNo} onChange={(e) => setForm({ ...form, batchNo: e.target.value })} /></label>
            </div>
            <button className="btn btn-primary"><Icon name="plus" size={15} /> Register</button>
          </form>
        </article>
        <article className="panel">
          <header className="panel-head"><div><h3>Registered serials</h3><p className="panel-sub">{serials.length} records</p></div></header>
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Serial</th><th>Product</th><th>Status</th><th>Warranty</th><th /></tr></thead><tbody>
            {serials.map((s) => (
              <tr key={s.id}><td className="fw-mono">{s.serial}</td><td>{s.productName}</td><td><span className={`badge ${s.status === 'in_stock' ? 'badge-success' : s.status === 'damaged' ? 'badge-danger' : 'badge-subtle'}`}>{s.status.replace('_', ' ')}</span></td><td className="muted">{s.warrantyUntil ? new Date(s.warrantyUntil).toLocaleDateString() : '—'}</td><td className="num"><div className="row-actions end">{s.status === 'in_stock' && <><button className="btn btn-ghost btn-sm" onClick={() => void run(() => setSerialStatus(s.id, 'sold'), 'Marked sold.')}>Sold</button><button className="btn btn-ghost btn-sm" onClick={() => void run(() => setSerialStatus(s.id, 'damaged'), 'Marked damaged.')}>Damaged</button></>}{s.status === 'sold' && <button className="btn btn-ghost btn-sm" onClick={() => void run(() => setSerialStatus(s.id, 'returned'), 'Returned.')}>Return</button>}</div></td></tr>
            ))}
            {serials.length === 0 && <tr><td colSpan={5} className="empty-table-cell">No serials registered.</td></tr>}
          </tbody></table></div>
        </article>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function ProductionTab() {
  const data = useLiveQuery(async () => {
    const [boms, orders, products] = await Promise.all([db.boms.toArray(), db.productionOrders.orderBy('at').reverse().toArray(), db.products.orderBy('name').toArray()]);
    return { boms, orders, products };
  }, []);
  const { run, msg, err } = useRunner();
  const [form, setForm] = useState({ productId: '', name: '', outputQty: '1', labor: '', overhead: '', items: [{ productId: '', qty: '' }] });
  const [orderForm, setOrderForm] = useState({ bomId: '', qty: '1' });
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <>
      <Banner msg={msg} err={err} />
      <section className="advanced-grid">
        <article className="panel">
          <header className="panel-head"><div><h3>New recipe / BOM</h3><p className="panel-sub">Components per finished batch</p></div></header>
          <form className="panel-body form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await saveBom({ productId: form.productId, name: form.name, outputQty: Number(form.outputQty) || 1, laborCost: Number(form.labor) || 0, overheadCost: Number(form.overhead) || 0, items: form.items.filter((i) => i.productId && Number(i.qty) > 0).map((i) => ({ productId: i.productId, qty: Number(i.qty) })) }); setForm({ productId: '', name: '', outputQty: '1', labor: '', overhead: '', items: [{ productId: '', qty: '' }] }); }, 'Recipe saved.'); }}>
            <div className="form-grid two-col">
              <label className="field"><span>Finished product</span><select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} required><option value="">Choose…</option>{data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label className="field"><span>Recipe name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
              <label className="field"><span>Output quantity</span><input type="number" min="1" step="any" value={form.outputQty} onChange={(e) => setForm({ ...form, outputQty: e.target.value })} /></label>
              <label className="field"><span>Labour cost per batch</span><input type="number" min="0" step="any" value={form.labor} onChange={(e) => setForm({ ...form, labor: e.target.value })} /></label>
              <label className="field"><span>Overhead per batch</span><input type="number" min="0" step="any" value={form.overhead} onChange={(e) => setForm({ ...form, overhead: e.target.value })} /></label>
            </div>
            <div className="component-rows">
              {form.items.map((it, i) => (
                <div className="component-row" key={i}>
                  <select value={it.productId} onChange={(e) => setForm({ ...form, items: form.items.map((row, n) => n === i ? { ...row, productId: e.target.value } : row) })} aria-label="Component"><option value="">Component…</option>{data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                  <input type="number" min="0" step="any" placeholder="Qty" value={it.qty} onChange={(e) => setForm({ ...form, items: form.items.map((row, n) => n === i ? { ...row, qty: e.target.value } : row) })} aria-label="Component quantity" />
                  <button type="button" className="icon-btn" onClick={() => setForm({ ...form, items: form.items.filter((_, n) => n !== i) })} disabled={form.items.length <= 1} aria-label="Remove component"><Icon name="close" size={13} /></button>
                </div>
              ))}
              <button type="button" className="link-btn" onClick={() => setForm({ ...form, items: [...form.items, { productId: '', qty: '' }] })}>+ Add component</button>
            </div>
            <button className="btn btn-primary">Save recipe</button>
          </form>
        </article>

        <article className="panel">
          <header className="panel-head"><div><h3>Production orders</h3><p className="panel-sub">{data.boms.length} recipes · {data.orders.filter((o) => o.status === 'planned').length} planned</p></div></header>
          <form className="panel-body form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await createProductionOrder(orderForm.bomId, Number(orderForm.qty)); setOrderForm({ bomId: '', qty: '1' }); }, 'Production order created.'); }}>
            <div className="form-grid two-col">
              <label className="field"><span>Recipe</span><select value={orderForm.bomId} onChange={(e) => setOrderForm({ ...orderForm, bomId: e.target.value })} required><option value="">Choose…</option>{data.boms.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <label className="field"><span>Quantity</span><input type="number" min="0" step="any" value={orderForm.qty} onChange={(e) => setOrderForm({ ...orderForm, qty: e.target.value })} /></label>
            </div>
            <button className="btn btn-primary" disabled={!orderForm.bomId}>Create order</button>
          </form>
          <ul className="task-list">
            {data.orders.map((o) => (
              <li key={o.id}><span><strong>{o.name}</strong><small>{o.number} · {o.status} · unit cost {money(o.unitCost)}</small></span>{o.status === 'planned' && <button className="btn btn-sm" onClick={() => void run(() => completeProductionOrder(o.id), 'Production completed.')}>Complete</button>}</li>
            ))}
          </ul>
        </article>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function AssetsTab() {
  const assets = useLiveQuery(() => db.assets.toArray(), [], []);
  const { run, msg, err } = useRunner();
  const [form, setForm] = useState({ name: '', category: 'Equipment', cost: '', life: '60', salvage: '' });
  const [selected, setSelected] = useState<FixedAsset | null>(null);
  return (
    <>
      <Banner msg={msg} err={err} />
      <section className="advanced-grid">
        <article className="panel">
          <header className="panel-head"><div><h3>Add a fixed asset</h3><p className="panel-sub">Straight-line depreciation, posted month by month</p></div></header>
          <form className="panel-body form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await addAsset({ name: form.name, category: form.category, cost: Number(form.cost), lifeMonths: Number(form.life), salvage: Number(form.salvage) || 0 }); setForm({ name: '', category: 'Equipment', cost: '', life: '60', salvage: '' }); }, 'Asset added.'); }}>
            <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <div className="form-grid two-col">
              <label className="field"><span>Category</span><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
              <label className="field"><span>Cost</span><input type="number" min="0" step="any" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} required /></label>
              <label className="field"><span>Life (months)</span><input type="number" min="1" value={form.life} onChange={(e) => setForm({ ...form, life: e.target.value })} /></label>
              <label className="field"><span>Salvage value</span><input type="number" min="0" step="any" value={form.salvage} onChange={(e) => setForm({ ...form, salvage: e.target.value })} /></label>
            </div>
            <button className="btn btn-primary">Add asset</button>
          </form>
        </article>
        <article className="panel">
          <header className="panel-head"><div><h3>Asset register</h3><p className="panel-sub">{assets.length} assets · net book value {money(assets.reduce((s, a) => s + a.cost - accumulatedDepreciation(a), 0))}</p></div></header>
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Asset</th><th className="num">Cost</th><th className="num">Monthly</th><th className="num">Posted</th><th /></tr></thead><tbody>
            {assets.map((a) => (
              <tr key={a.id}><td><strong>{a.name}</strong><div className="muted small">{a.category} · {a.lifeMonths} months</div></td><td className="num">{money(a.cost)}</td><td className="num">{money(monthlyDepreciation(a))}</td><td className="num">{a.monthsPosted ?? 0}/{a.lifeMonths}</td><td className="num"><button className="btn btn-ghost btn-sm" onClick={() => { setSelected(a); void run(() => postDepreciation(a.id), 'Depreciation posted.'); }}>Post month</button></td></tr>
            ))}
            {assets.length === 0 && <tr><td colSpan={5} className="empty-table-cell">No assets yet.</td></tr>}
          </tbody></table></div>
          {selected && <p className="panel-note"><Icon name="check" size={14} /> Last action applied to {selected.name}. Depreciation posts to account 7100 and accumulates in 1510.</p>}
        </article>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function BudgetsTab() {
  const data = useLiveQuery(async () => ({ budgets: await db.budgets.toArray(), ledger: await loadLedger() }), []);
  const { run, msg, err } = useRunner();
  const [form, setForm] = useState({ name: '', start: '', end: '', lines: [{ account: '6100', amount: '' }] });
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <>
      <Banner msg={msg} err={err} />
      <section className="advanced-grid">
        <article className="panel">
          <header className="panel-head"><div><h3>New budget</h3><p className="panel-sub">Compare planned and actual account balances</p></div></header>
          <form className="panel-body form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await saveBudget({ name: form.name, start: new Date(form.start).getTime(), end: new Date(form.end).getTime(), lines: form.lines.filter((l) => l.account && Number(l.amount) >= 0).map((l) => ({ account: l.account, amount: Number(l.amount) })) }); setForm({ name: '', start: '', end: '', lines: [{ account: '6100', amount: '' }] }); }, 'Budget saved.'); }}>
            <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <div className="form-grid two-col">
              <label className="field"><span>Start</span><input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} required /></label>
              <label className="field"><span>End</span><input type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} required /></label>
            </div>
            {form.lines.map((l, i) => (
              <div className="component-row" key={i}>
                <select value={l.account} onChange={(e) => setForm({ ...form, lines: form.lines.map((row, n) => n === i ? { ...row, account: e.target.value } : row) })} aria-label="Account">{CHART_OF_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select>
                <input type="number" min="0" step="any" placeholder="Amount" value={l.amount} onChange={(e) => setForm({ ...form, lines: form.lines.map((row, n) => n === i ? { ...row, amount: e.target.value } : row) })} aria-label="Budget amount" />
                <button type="button" className="icon-btn" onClick={() => setForm({ ...form, lines: form.lines.filter((_, n) => n !== i) })} disabled={form.lines.length <= 1} aria-label="Remove line"><Icon name="close" size={13} /></button>
              </div>
            ))}
            <button type="button" className="link-btn" onClick={() => setForm({ ...form, lines: [...form.lines, { account: '6100', amount: '' }] })}>+ Add account</button>
            <button className="btn btn-primary">Save budget</button>
          </form>
        </article>

        <article className="panel">
          <header className="panel-head"><div><h3>Budget variance</h3><p className="panel-sub">Budget minus actual</p></div></header>
          {data.budgets.length === 0 ? <div className="empty-state compact"><p>No budgets yet.</p></div> : data.budgets.map((b) => {
            const v = budgetVariance(b, data.ledger);
            return (
              <div className="budget-block" key={b.id}>
                <div className="budget-head"><strong>{b.name}</strong><span className="muted small">{new Date(b.start).toLocaleDateString()} — {new Date(b.end).toLocaleDateString()}</span></div>
                <table className="data-table compact-table"><thead><tr><th>Account</th><th className="num">Budget</th><th className="num">Actual</th><th className="num">Variance</th></tr></thead><tbody>
                  {v.rows.map((r) => <tr key={r.account}><td>{r.name}</td><td className="num">{money(r.budget)}</td><td className="num">{money(r.actual)}</td><td className={`num ${r.variance < 0 ? 'text-danger' : 'text-success'}`}>{money(r.variance)}</td></tr>)}
                  <tr className="row-total"><td>Total</td><td className="num">{money(v.totalBudget)}</td><td className="num">{money(v.totalActual)}</td><td className="num">{money(v.totalVariance)}</td></tr>
                </tbody></table>
              </div>
            );
          })}
        </article>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function PayrollTab() {
  const [employees, payslips] = useLiveQuery(async () => Promise.all([db.employees.toArray(), db.payslips.orderBy('at').reverse().toArray()]), [], [[], []]);
  const { run, msg, err } = useRunner();
  const [form, setForm] = useState({ name: '', role: 'Staff', salary: '', tax: '7.5', pension: '8' });
  const month = new Date().toISOString().slice(0, 7);
  const start = new Date(`${month}-01T00:00:00`).getTime();
  const end = new Date(new Date(`${month}-01T00:00:00`).setMonth(new Date().getMonth() + 1) - 1).getTime();
  const totals = employees.reduce((s, e) => { const f = payrollFigures(e); return { gross: s.gross + f.gross, net: s.net + f.net }; }, { gross: 0, net: 0 });
  return (
    <>
      <Banner msg={msg} err={err} />
      <section className="advanced-grid">
        <article className="panel">
          <header className="panel-head"><div><h3>Add an employee</h3><p className="panel-sub">Monthly gross, PAYE and pension rates</p></div></header>
          <form className="panel-body form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await addEmployee({ name: form.name, role: form.role, salary: Number(form.salary), taxRate: Number(form.tax), pensionRate: Number(form.pension) }); setForm({ name: '', role: 'Staff', salary: '', tax: '7.5', pension: '8' }); }, 'Employee added.'); }}>
            <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <div className="form-grid two-col">
              <label className="field"><span>Role</span><input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></label>
              <label className="field"><span>Monthly gross</span><input type="number" min="0" step="any" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} required /></label>
              <label className="field"><span>PAYE %</span><input type="number" min="0" max="100" step="any" value={form.tax} onChange={(e) => setForm({ ...form, tax: e.target.value })} /></label>
              <label className="field"><span>Pension %</span><input type="number" min="0" max="100" step="any" value={form.pension} onChange={(e) => setForm({ ...form, pension: e.target.value })} /></label>
            </div>
            <button className="btn btn-primary">Add employee</button>
          </form>
          <div className="panel-body">
            <button className="btn btn-secondary" onClick={() => void run(() => runPayroll(start, end), 'Payroll draft created.')}><Icon name="users" size={15} /> Run payroll for {month}</button>
            <p className="panel-sub" style={{ marginTop: 8 }}>{employees.length} active staff · monthly gross {money(totals.gross)} · net {money(totals.net)}</p>
          </div>
        </article>

        <article className="panel">
          <header className="panel-head"><div><h3>Payslips</h3><p className="panel-sub">Payroll posts salaries, PAYE and net pay to the ledger</p></div></header>
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Employee</th><th className="num">Gross</th><th className="num">Deductions</th><th className="num">Net</th><th>Status</th><th /></tr></thead><tbody>
            {payslips.map((p) => (
              <tr key={p.id}><td><strong>{p.employeeName}</strong><div className="muted small">{p.number}</div></td><td className="num">{money(p.gross)}</td><td className="num">{money(p.tax + p.pension)}</td><td className="num">{money(p.net)}</td><td><span className={`badge ${p.status === 'paid' ? 'badge-success' : 'badge-warning'}`}>{p.status}</span></td><td className="num">{p.status === 'draft' && <button className="btn btn-ghost btn-sm" onClick={() => void run(() => payPayslip(p.id), 'Payslip paid.')}>Pay</button>}</td></tr>
            ))}
            {payslips.length === 0 && <tr><td colSpan={6} className="empty-table-cell">No payslips yet.</td></tr>}
          </tbody></table></div>
        </article>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function CurrenciesTab() {
  const currencies = useLiveQuery(() => db.currencies.toArray(), [], []);
  const { run, msg, err } = useRunner();
  const [form, setForm] = useState({ code: 'USD', name: 'US Dollar', symbol: '$', rate: '' });
  return (
    <>
      <Banner msg={msg} err={err} />
      <section className="advanced-grid">
        <article className="panel">
          <header className="panel-head"><div><h3>Add an exchange rate</h3><p className="panel-sub">Base units per one unit of foreign currency</p></div></header>
          <form className="panel-body form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await saveCurrency({ code: form.code, name: form.name, symbol: form.symbol, rate: Number(form.rate) }); setForm({ ...form, rate: '' }); }, 'Currency saved.'); }}>
            <div className="form-grid two-col">
              <label className="field"><span>Code</span><input value={form.code} maxLength={3} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required /></label>
              <label className="field"><span>Symbol</span><input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} /></label>
              <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label className="field"><span>Rate ({config.currencySymbol} per 1)</span><input type="number" min="0" step="any" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} required /></label>
            </div>
            <button className="btn btn-primary">Save currency</button>
          </form>
        </article>
        <article className="panel">
          <header className="panel-head"><div><h3>Currencies</h3><p className="panel-sub">POS converts foreign tenders to base at sale time</p></div></header>
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Code</th><th>Name</th><th className="num">Rate</th><th>Updated</th></tr></thead><tbody>
            {currencies.map((c) => <tr key={c.code}><td className="fw-mono">{c.code}</td><td>{c.name} ({c.symbol})</td><td className="num">{money(c.rate)}</td><td className="muted">{new Date(c.updatedAt).toLocaleDateString()}</td></tr>)}
            {currencies.length === 0 && <tr><td colSpan={4} className="empty-table-cell">Only the base currency is configured.</td></tr>}
          </tbody></table></div>
        </article>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function TaxesTab() {
  const rates = useLiveQuery(() => db.taxRates.toArray(), [], []);
  const { run, msg, err } = useRunner();
  const [form, setForm] = useState({ name: 'VAT', rate: '7.5', inclusive: true });
  return (
    <>
      <Banner msg={msg} err={err} />
      <section className="advanced-grid">
        <article className="panel">
          <header className="panel-head"><div><h3>Add a tax rule</h3><p className="panel-sub">Assign it to products in the catalogue</p></div></header>
          <form className="panel-body form" onSubmit={(e) => { e.preventDefault(); void run(async () => { const rec = { id: uid(), name: form.name, rate: Number(form.rate), inclusive: form.inclusive, accountCode: '2100', active: true }; await db.transaction('rw', [db.taxRates, db.outbox], async () => { await db.taxRates.add(rec); await queueAdvanced('taxRates', rec); }); }, 'Tax rule added.'); }}>
            <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <div className="form-grid two-col">
              <label className="field"><span>Rate %</span><input type="number" min="0" step="any" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} required /></label>
              <label className="field"><span>Treatment</span><select value={form.inclusive ? 'inc' : 'exc'} onChange={(e) => setForm({ ...form, inclusive: e.target.value === 'inc' })}><option value="inc">Included in price</option><option value="exc">Added to price</option></select></label>
            </div>
            <button className="btn btn-primary">Add tax rule</button>
          </form>
        </article>
        <article className="panel">
          <header className="panel-head"><div><h3>Tax rules</h3><p className="panel-sub">Posted to tax payable (2100)</p></div></header>
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Name</th><th className="num">Rate</th><th>Treatment</th><th>Status</th><th /></tr></thead><tbody>
            {rates.map((r) => <tr key={r.id}><td>{r.name}</td><td className="num">{r.rate}%</td><td>{r.inclusive ? 'Inclusive' : 'Exclusive'}</td><td><span className={`badge ${r.active ? 'badge-success' : 'badge-subtle'}`}>{r.active ? 'Active' : 'Off'}</span></td><td className="num"><button className="btn btn-ghost btn-sm" onClick={() => void run(async () => { const next = { ...r, active: !r.active }; await db.transaction('rw', [db.taxRates, db.outbox], async () => { await db.taxRates.put(next); await queueAdvanced('taxRates', next); }); }, 'Tax rule updated.')}>{r.active ? 'Disable' : 'Enable'}</button></td></tr>)}
            {rates.length === 0 && <tr><td colSpan={5} className="empty-table-cell">No tax rules. The till charges no tax.</td></tr>}
          </tbody></table></div>
        </article>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function BankingTab() {
  const data = useLiveQuery(async () => ({ accounts: await db.bankAccounts.toArray(), transactions: await db.bankTransactions.orderBy('date').reverse().toArray(), ledger: await loadLedger() }), []);
  const { run, msg, err } = useRunner();
  const [accountForm, setAccountForm] = useState({ name: '', bank: '', number: '', opening: '' });
  const [txForm, setTxForm] = useState({ accountId: '', date: new Date().toISOString().slice(0, 10), description: '', amount: '', reference: '' });
  const [selected, setSelected] = useState('');
  if (!data) return <p className="muted">Loading…</p>;
  const account = data.accounts.find((a) => a.id === selected) ?? data.accounts[0];
  const transactions = account ? data.transactions.filter((t) => t.bankAccountId === account.id) : [];
  const book = account ? (accountBalances(data.ledger).find((r) => r.code === account.accountCode)?.balance ?? 0) : 0;
  const rec = account ? reconcile(account, transactions, book) : null;
  return (
    <>
      <Banner msg={msg} err={err} />
      <section className="advanced-grid">
        <article className="panel">
          <header className="panel-head"><div><h3>Bank accounts</h3><p className="panel-sub">Mapped to a ledger account</p></div></header>
          <form className="panel-body form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await addBankAccount({ name: accountForm.name, bank: accountForm.bank, number: accountForm.number, openingBalance: Number(accountForm.opening) || 0 }); setAccountForm({ name: '', bank: '', number: '', opening: '' }); }, 'Bank account added.'); }}>
            <div className="form-grid two-col">
              <label className="field"><span>Account name</span><input value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} required /></label>
              <label className="field"><span>Bank</span><input value={accountForm.bank} onChange={(e) => setAccountForm({ ...accountForm, bank: e.target.value })} /></label>
              <label className="field"><span>Number</span><input value={accountForm.number} onChange={(e) => setAccountForm({ ...accountForm, number: e.target.value })} /></label>
              <label className="field"><span>Opening balance</span><input type="number" step="any" value={accountForm.opening} onChange={(e) => setAccountForm({ ...accountForm, opening: e.target.value })} /></label>
            </div>
            <button className="btn btn-primary">Add account</button>
          </form>
          {data.accounts.length > 0 && rec && (
            <div className="panel-body">
              <select value={account?.id ?? ''} onChange={(e) => setSelected(e.target.value)} aria-label="Bank account">{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.bank}</option>)}</select>
              <ul className="balance-list" style={{ padding: '10px 0 0' }}>
                <li><span>Ledger balance</span><strong>{money(rec.bookBalance)}</strong></li>
                <li><span>Statement balance</span><strong>{money(rec.statementBalance)}</strong></li>
                <li><span>Cleared balance</span><strong>{money(rec.clearedBalance)}</strong></li>
                <li className="balance-total"><span>Difference</span><strong className={Math.abs(rec.difference) < 0.01 ? 'text-success' : 'text-warning'}>{money(rec.difference)}</strong></li>
              </ul>
            </div>
          )}
        </article>

        <article className="panel">
          <header className="panel-head"><div><h3>Statement lines</h3><p className="panel-sub">Tick a line when it appears on the bank statement</p></div></header>
          {account && (
            <form className="panel-body form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await addBankTransaction({ bankAccountId: account.id, date: new Date(`${txForm.date}T12:00:00`).getTime(), description: txForm.description, amount: Number(txForm.amount), reference: txForm.reference }); setTxForm({ ...txForm, description: '', amount: '', reference: '' }); }, 'Statement line added.'); }}>
              <div className="form-grid two-col">
                <label className="field"><span>Date</span><input type="date" value={txForm.date} onChange={(e) => setTxForm({ ...txForm, date: e.target.value })} /></label>
                <label className="field"><span>Amount (+ in / − out)</span><input type="number" step="any" value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} required /></label>
                <label className="field"><span>Description</span><input value={txForm.description} onChange={(e) => setTxForm({ ...txForm, description: e.target.value })} required /></label>
                <label className="field"><span>Reference</span><input value={txForm.reference} onChange={(e) => setTxForm({ ...txForm, reference: e.target.value })} /></label>
              </div>
              <button className="btn btn-primary">Add statement line</button>
            </form>
          )}
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th><th>Status</th><th /></tr></thead><tbody>
            {transactions.map((t) => <tr key={t.id}><td className="muted">{new Date(t.date).toLocaleDateString()}</td><td>{t.description}<div className="muted small">{t.reference}</div></td><td className={`num ${t.amount < 0 ? 'text-danger' : ''}`}>{money(t.amount)}</td><td><span className={`badge ${t.status === 'cleared' ? 'badge-success' : 'badge-warning'}`}>{t.status}</span></td><td className="num"><button className="btn btn-ghost btn-sm" onClick={() => void run(() => toggleBankTransaction(t.id), 'Reconciliation updated.')}>{t.status === 'cleared' ? 'Unclear' : 'Clear'}</button></td></tr>)}
            {transactions.length === 0 && <tr><td colSpan={5} className="empty-table-cell">No statement lines.</td></tr>}
          </tbody></table></div>
        </article>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function ApprovalsTab() {
  const approvals = useLiveQuery(() => db.approvals.orderBy('requestedAt').reverse().toArray(), [], []);
  const { run, msg, err } = useRunner();
  const user = getSession()?.username ?? 'local';
  const [threshold, setThreshold] = useState(String(config.approvalThreshold));
  return (
    <>
      <Banner msg={msg} err={err} />
      <section className="advanced-grid">
        <article className="panel">
          <header className="panel-head"><div><h3>Approval policy</h3><p className="panel-sub">Refunds and voids above this amount need an approved request</p></div></header>
          <form className="panel-body form" onSubmit={(e) => { e.preventDefault(); saveConfig({ approvalThreshold: Math.max(0, Number(threshold) || 0) }); void run(async () => undefined, 'Policy saved.'); }}>
            <label className="field"><span>Threshold ({config.currencySymbol})</span><input type="number" min="0" step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></label>
            <button className="btn btn-primary">Save policy</button>
            <p className="panel-sub">Set to 0 to disable approvals. A manager approves requests in this queue; a cashier can then retry the refund or void.</p>
          </form>
        </article>
        <article className="panel">
          <header className="panel-head"><div><h3>Approval queue</h3><p className="panel-sub">{approvals.filter((a) => a.status === 'pending').length} pending</p></div></header>
          {approvals.length === 0 ? <div className="empty-state compact"><p>No approval requests.</p></div> : (
            <ul className="approval-list">
              {approvals.map((a: Approval) => (
                <li key={a.id}>
                  <span className={`notify-dot ${a.status === 'pending' ? 'warn' : a.status === 'approved' ? 'info' : 'danger'}`} />
                  <span className="approval-main"><strong>{a.summary}</strong><small>{a.kind} · {money(a.amount)} · {a.requestedBy} · {new Date(a.requestedAt).toLocaleString()}</small>{a.note && <small>Note: {a.note}</small>}</span>
                  {a.status === 'pending' ? (
                    <span className="row-actions">
                      <button className="btn btn-sm" onClick={() => void run(() => decideApproval(a.id, true, '', user), 'Approved.')}>Approve</button>
                      <button className="btn btn-ghost btn-sm danger-hover" onClick={() => void run(() => decideApproval(a.id, false, '', user), 'Rejected.')}>Reject</button>
                    </span>
                  ) : <span className={`badge ${a.status === 'approved' ? 'badge-success' : 'badge-danger'}`}>{a.status}</span>}
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function Banner({ msg, err }: { msg: string; err: string }) {
  return (
    <>
      {err && <div className="alert-error" role="alert">{err}</div>}
      {msg && <div className="alert-success">{msg}</div>}
    </>
  );
}

