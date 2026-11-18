import { useMemo, useState } from 'react';
import { config, clone, saveConfig, formatMoney, type AppConfig } from '../config';
import { NAV_CATALOG, NAV_GROUPS } from '../navigation';
import { Icon } from '../components/Icon';
import { QrCode } from '../components/QrCode';

type Tab = 'identity' | 'receipt' | 'invoice' | 'navigation';

const sample = {
  number: 'INV-20261118-A7F-0042',
  at: Date.now(),
  customer: 'Mama Ade',
  payment: 'Cash',
  cashier: 'amaka',
  items: [
    { name: 'Rice 50kg Bag', qty: 1, price: 45000 },
    { name: 'Vegetable Oil 5L', qty: 2, price: 9500 },
    { name: 'Coke Bottle 50cl', qty: 3, price: 300 },
  ],
  subtotal: 64900,
  discount: 1900,
  tax: 4395.35,
  total: 63000,
};

export function Branding({ onChange }: { onChange: () => void }) {
  const [draft, setDraft] = useState<AppConfig>(() => clone(config));
  const [tab, setTab] = useState<Tab>('identity');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const b = draft.branding;
  const setB = <K extends keyof AppConfig['branding']>(k: K, v: AppConfig['branding'][K]) => setDraft({ ...draft, branding: { ...draft.branding, [k]: v } });
  const setPrinter = <K extends keyof AppConfig['printer']>(k: K, v: AppConfig['printer'][K]) => setDraft({ ...draft, printer: { ...draft.printer, [k]: v } });

  const save = () => {
    setErr('');
    saveConfig(draft);
    onChange();
    setMsg('Branding saved on this device. Publish the same values in config.json for a deployment default.');
  };

  const readLogo = (file: File | undefined, key: 'logo' | 'loginLogo' | 'favicon') => {
    setErr('');
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Choose an image file.'); return; }
    if (file.size > 300 * 1024) { setErr('Keep the image under 300 KB so the device configuration stays fast.'); return; }
    const reader = new FileReader();
    reader.onload = () => setB(key, String(reader.result));
    reader.readAsDataURL(file);
  };

  const printPreview = () => window.print();

  return (
    <div className="branding-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Identity studio</span>
          <h1>Branding &amp; receipts</h1>
          <p className="lede">White-label the application, design thermal receipts and A4 invoices, and choose which navigation each role sees.</p>
        </div>
        <div className="page-head-actions">
          <button className={`btn ${tab === 'identity' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('identity')}>Brand identity</button>
          <button className={`btn ${tab === 'receipt' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('receipt')}>Receipt designer</button>
          <button className={`btn ${tab === 'invoice' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('invoice')}>A4 invoice</button>
          <button className={`btn ${tab === 'navigation' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('navigation')}>Navigation</button>
          <button className="btn btn-primary" onClick={save}><Icon name="check" size={15} /> Save</button>
        </div>
      </header>

      {err && <div className="alert-error">{err}</div>}
      {msg && <div className="alert-success">{msg}</div>}

      {tab === 'identity' && (
        <section className="branding-grid">
          <article className="panel">
            <header className="panel-head"><div><h3>Identity</h3><p className="panel-sub">Names, colours and contact details</p></div></header>
            <div className="panel-body form">
              <div className="form-grid two-col">
                <label className="field"><span>Application name</span><input value={draft.appName} onChange={(e) => setDraft({ ...draft, appName: e.target.value })} /></label>
                <label className="field"><span>Business name (documents)</span><input value={b.businessName} onChange={(e) => setB('businessName', e.target.value)} /></label>
                <label className="field"><span>Tagline</span><input value={draft.tagline} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} /></label>
                <label className="field"><span>Website</span><input value={b.website} onChange={(e) => setB('website', e.target.value)} placeholder="https://" /></label>
                <label className="field"><span>Primary colour</span><input type="color" value={draft.primaryColor} onChange={(e) => setDraft({ ...draft, primaryColor: e.target.value })} /></label>
                <label className="field"><span>Secondary colour</span><input type="color" value={b.secondaryColor} onChange={(e) => setB('secondaryColor', e.target.value)} /></label>
                <label className="field"><span>Phone</span><input value={b.phone} onChange={(e) => setB('phone', e.target.value)} /></label>
                <label className="field"><span>Email</span><input value={b.email} onChange={(e) => setB('email', e.target.value)} /></label>
              </div>
              <label className="field"><span>Address</span><textarea rows={2} value={b.address} onChange={(e) => setB('address', e.target.value)} /></label>
              <label className="field"><span>Footer message</span><input value={b.footer} onChange={(e) => setB('footer', e.target.value)} /></label>
              <div className="asset-uploads">
                {([['logo', 'Main logo'], ['loginLogo', 'Login logo'], ['favicon', 'Favicon / PWA icon']] as const).map(([key, label]) => (
                  <div className="asset-upload" key={key}>
                    <span className="asset-thumb">{b[key] ? <img src={b[key]} alt="" /> : <Icon name="store" size={18} />}</span>
                    <span><strong>{label}</strong><small>{b[key] ? 'Custom image' : 'Using the built-in mark'}</small></span>
                    <label className="btn btn-secondary btn-sm">{b[key] ? 'Replace' : 'Upload'}<input type="file" accept="image/*" hidden onChange={(e) => readLogo(e.target.files?.[0], key)} /></label>
                    {b[key] && <button type="button" className="icon-btn" onClick={() => setB(key, '')} aria-label={`Remove ${label}`}><Icon name="trash" size={14} /></button>}
                  </div>
                ))}
              </div>
            </div>
          </article>
          <article className="panel preview-panel">
            <header className="panel-head"><div><h3>Live preview</h3><p className="panel-sub">Sidebar and sign-in</p></div></header>
            <div className="brand-preview">
              <div className="mini-sidebar">
                <div className="mini-brand">
                  {b.logo ? <img src={b.logo} alt="" /> : <span className="brand-mark"><Icon name="store" size={16} /></span>}
                  <span><strong>{draft.appName || 'Your app'}</strong><small>{b.businessName || 'Your business'}</small></span>
                </div>
                {['Dashboard', 'Point of sale', 'Products', 'Reports', 'Settings'].map((x, i) => <span key={x} className={`mini-nav ${i === 0 ? 'active' : ''}`}>{x}</span>)}
              </div>
              <div className="mini-login">
                <span className="mini-login-brand">{b.loginLogo ? <img src={b.loginLogo} alt="" /> : <span className="brand-mark"><Icon name="store" size={15} /></span>} {draft.appName}</span>
                <strong>Welcome back</strong>
                <small>Sign in to continue</small>
                <span className="mini-input" />
                <span className="mini-input" />
                <span className="mini-button">Sign in</span>
              </div>
            </div>
            <div className="panel-foot"><span>Primary {draft.primaryColor}</span><span>Secondary {b.secondaryColor}</span></div>
          </article>
        </section>
      )}

      {tab === 'receipt' && (
        <section className="designer-grid">
          <article className="panel">
            <header className="panel-head"><div><h3>Receipt layout</h3><p className="panel-sub">Thermal 58 mm / 80 mm</p></div></header>
            <div className="panel-body form">
              <div className="form-grid two-col">
                <label className="field"><span>Template</span><select value={b.receiptTemplate} onChange={(e) => setB('receiptTemplate', e.target.value as AppConfig['branding']['receiptTemplate'])}><option value="classic">Classic centred</option><option value="compact">Compact</option><option value="modern">Modern block</option></select></label>
                <label className="field"><span>Paper</span><select value={draft.printer.paperMm} onChange={(e) => setPrinter('paperMm', Number(e.target.value) as 58 | 80)}><option value={58}>58 mm</option><option value={80}>80 mm</option></select></label>
              </div>
              {([['showLogo', 'Show logo'], ['showAddress', 'Show address'], ['showPhone', 'Show phone'], ['showTax', 'Show tax'], ['showQr', 'Show QR code'], ['auto', 'Print after every sale']] as const).map(([key, label]) => (
                <label className="check-field" key={key}>
                  <input type="checkbox" checked={key === 'auto' ? draft.printer.auto : Boolean(b[key])} onChange={(e) => key === 'auto' ? setPrinter('auto', e.target.checked) : setB(key, e.target.checked)} />
                  <span><strong>{label}</strong></span>
                </label>
              ))}
              <label className="field"><span>QR content</span><input value={b.qrText} onChange={(e) => setB('qrText', e.target.value)} placeholder="e.g. receipt verification URL" /></label>
              <label className="field"><span>Receipt footer</span><input value={b.footer} onChange={(e) => setB('footer', e.target.value)} /></label>
            </div>
          </article>
          <article className="panel preview-panel print-preview">
            <header className="panel-head"><div><h3>Previews</h3><p className="panel-sub">Thermal receipt and 80 mm layout</p></div><button className="btn btn-secondary btn-sm" onClick={printPreview}><Icon name="printer" size={14} /> Print preview</button></header>
            <div className="receipt-preview-wrap">
              <div className={`receipt receipt-${b.receiptTemplate}`} style={{ width: draft.printer.paperMm === 80 ? 340 : 260 }}>
                <div className="receipt-brand">
                  {b.showLogo && b.logo && <img src={b.logo} alt="" className="receipt-logo" />}
                  <div>
                    <h3>{b.businessName || draft.appName}</h3>
                    {b.showAddress && b.address && <p className="receipt-meta">{b.address}</p>}
                    {b.showPhone && b.phone && <p className="receipt-meta">{b.phone}</p>}
                    {b.website && <p className="receipt-meta">{b.website}</p>}
                  </div>
                </div>
                <hr className="receipt-divider" />
                <div className="receipt-total-row"><span>{sample.number}</span><span>{new Date(sample.at).toLocaleDateString()}</span></div>
                <div className="receipt-total-row"><span>{sample.customer}</span><span>{sample.payment}</span></div>
                <div className="receipt-total-row"><span>Cashier</span><span>{sample.cashier}</span></div>
                <hr className="receipt-divider" />
                {sample.items.map((it) => <div className="receipt-item-row" key={it.name}><span>{it.qty} × {it.name}</span><span>{formatMoney(it.qty * it.price)}</span></div>)}
                <hr className="receipt-divider" />
                <div className="receipt-total-row"><span>Subtotal</span><span>{formatMoney(sample.subtotal)}</span></div>
                <div className="receipt-total-row"><span>Discount</span><span>−{formatMoney(sample.discount)}</span></div>
                {b.showTax && <div className="receipt-total-row"><span>VAT included</span><span>{formatMoney(sample.tax)}</span></div>}
                <div className="receipt-total-row grand"><span>Total</span><span>{formatMoney(sample.total)}</span></div>
                {b.showQr && <div className="receipt-qr"><QrCode text={b.qrText || `${b.website || 'OpenPOS'}/${sample.number}`} size={82} /></div>}
                <p className="center small muted">{b.footer}</p>
              </div>
            </div>
          </article>
        </section>
      )}

      {tab === 'invoice' && (
        <section className="designer-grid">
          <article className="panel">
            <header className="panel-head"><div><h3>Invoice details</h3><p className="panel-sub">A4 customer invoice</p></div></header>
            <div className="panel-body form">
              <label className="field"><span>Invoice terms</span><textarea rows={3} value={b.invoiceTerms} onChange={(e) => setB('invoiceTerms', e.target.value)} /></label>
              <label className="field"><span>Payment note / bank details</span><textarea rows={3} value={b.footer} onChange={(e) => setB('footer', e.target.value)} /></label>
              <label className="check-field"><input type="checkbox" checked={b.showLogo} onChange={(e) => setB('showLogo', e.target.checked)} /><span><strong>Show logo on invoice</strong></span></label>
              <label className="check-field"><input type="checkbox" checked={b.showQr} onChange={(e) => setB('showQr', e.target.checked)} /><span><strong>Show QR code on invoice</strong></span></label>
              <button className="btn btn-secondary" onClick={printPreview}><Icon name="printer" size={15} /> Print / save as PDF</button>
            </div>
          </article>
          <article className="panel preview-panel print-preview">
            <header className="panel-head"><div><h3>A4 invoice preview</h3><p className="panel-sub">White-label layout</p></div></header>
            <div className="invoice-paper invoice-print">
              <div className="invoice-head">
                <div className="invoice-brand">
                  {b.showLogo && b.logo && <img src={b.logo} alt="" />}
                  <div><h2>{b.businessName || draft.appName}</h2>{b.address && <p>{b.address}</p>}{b.phone && <p>{b.phone}</p>}{b.email && <p>{b.email}</p>}</div>
                </div>
                <div className="invoice-title"><span>INVOICE</span><strong>{sample.number}</strong><p>{new Date(sample.at).toLocaleDateString()}</p></div>
              </div>
              <div className="invoice-parties">
                <div><span>Bill to</span><strong>{sample.customer}</strong><p>Customer account</p></div>
                <div><span>Payment</span><strong>{sample.payment}</strong><p>Due on receipt</p></div>
              </div>
              <table className="invoice-table"><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>
                {sample.items.map((it) => <tr key={it.name}><td>{it.name}</td><td>{it.qty}</td><td>{formatMoney(it.price)}</td><td>{formatMoney(it.qty * it.price)}</td></tr>)}
              </tbody></table>
              <div className="invoice-totals">
                <div><span>Subtotal</span><span>{formatMoney(sample.subtotal)}</span></div>
                <div><span>Discount</span><span>−{formatMoney(sample.discount)}</span></div>
                {b.showTax && <div><span>VAT included</span><span>{formatMoney(sample.tax)}</span></div>}
                <div className="grand"><span>Total</span><span>{formatMoney(sample.total)}</span></div>
              </div>
              <div className="invoice-foot">
                <div><span>Terms</span><p>{b.invoiceTerms}</p><span>Note</span><p>{b.footer}</p></div>
                {b.showQr && <QrCode text={b.qrText || sample.number} size={92} />}
              </div>
            </div>
          </article>
        </section>
      )}

      {tab === 'navigation' && <NavigationStudio draft={draft} setDraft={setDraft} />}

      <div className="savebar">
        {msg && <span className="muted">{msg}</span>}
        <button className="btn btn-primary" onClick={save}>Save branding</button>
      </div>
    </div>
  );
}

function NavigationStudio({ draft, setDraft }: { draft: AppConfig; setDraft: (c: AppConfig) => void }) {
  const hidden = new Set(draft.navigation.hidden);
  const order = draft.navigation.order;
  const ordered = useMemo(() => {
    const index = (id: string) => { const i = order.indexOf(id); return i === -1 ? 9999 : i; };
    return [...NAV_CATALOG].sort((a, b) => index(a.id) - index(b.id) || NAV_CATALOG.indexOf(a) - NAV_CATALOG.indexOf(b));
  }, [order]);
  const setOrder = (ids: string[]) => setDraft({ ...draft, navigation: { ...draft.navigation, order: ids } });
  const move = (id: string, dir: -1 | 1) => {
    const ids = ordered.map((n) => n.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    setOrder(ids);
  };
  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id); else next.add(id);
    setDraft({ ...draft, navigation: { ...draft.navigation, hidden: [...next] } });
  };
  return (
    <section className="advanced-grid">
      <article className="panel">
        <header className="panel-head"><div><h3>Sidebar order &amp; visibility</h3><p className="panel-sub">Applied per device; permissions still win</p></div><button className="btn btn-ghost btn-sm" onClick={() => setDraft({ ...draft, navigation: { hidden: [], order: [] } })}>Reset</button></header>
        <ul className="nav-config-list">
          {NAV_GROUPS.map((group) => {
            const items = ordered.filter((n) => n.group === group);
            if (!items.length) return null;
            return (
              <li key={group}>
                <span className="nav-config-group">{group}</span>
                {items.map((item) => (
                  <div className={`nav-config-row ${hidden.has(item.id) ? 'off' : ''}`} key={item.id}>
                    <label><input type="checkbox" checked={item.id === 'settings' || !hidden.has(item.id)} disabled={item.id === 'settings'} onChange={() => toggle(item.id)} /><Icon name={item.icon} size={15} /><span>{item.label}</span>{item.id === 'settings' && <small>required</small>}{item.managerOnly && <small>manager</small>}{item.superOnly && <small>owner</small>}</label>
                    <span className="row-actions"><button className="icon-btn" onClick={() => move(item.id, -1)} aria-label="Move up"><Icon name="arrowUp" size={13} /></button><button className="icon-btn" onClick={() => move(item.id, 1)} aria-label="Move down"><Icon name="arrowDown" size={13} /></button></span>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      </article>
      <article className="panel">
        <header className="panel-head"><div><h3>Preview</h3><p className="panel-sub">What this role will see</p></div></header>
        <div className="nav-preview">
          {ordered.filter((n) => !hidden.has(n.id)).map((n) => (
            <div key={n.id}><Icon name={n.icon} size={15} /><span>{n.label}</span></div>
          ))}
        </div>
      </article>
    </section>
  );
}
