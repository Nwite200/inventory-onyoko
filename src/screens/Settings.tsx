import { useState } from 'react';
import { db } from '../db';
import { config, presets, saveConfig, type AppConfig, clone } from '../config';
import { seedDemo } from '../actions';
import { syncNow } from '../sync';
import { api, getSession, serverMode } from '../auth';
import { Users } from './Users';
import { Businesses } from './Businesses';
import { Account } from './Account';
import { Shops } from './Shops';
import { PrinterSetup } from './PrinterSetup';
import { VoiceSetup } from './VoiceSetup';
import { LANGUAGES, t, type Lang } from '../i18n';

export function Settings({ canManage, isAdmin, onChange }: { canManage: boolean; isAdmin: boolean; onChange: () => void }) {
  const [draft, setDraft] = useState<AppConfig>(() => clone(config));
  const [msg, setMsg] = useState('');

  const account = serverMode() && getSession() ? <Account /> : null;
  if (!canManage)
    return (
      <div className="settings">
        {account}
        <p className="muted">Only managers and admins can change other settings.</p>
      </div>
    );

  const set = <K extends keyof AppConfig>(k: K, v: AppConfig[K]) => setDraft({ ...draft, [k]: v });
  const flag = (k: keyof AppConfig['features']) => setDraft({ ...draft, features: { ...draft.features, [k]: !draft.features[k] } });
  const llm = (k: keyof AppConfig['llm'], v: string) => setDraft({ ...draft, llm: { ...draft.llm, [k]: v } });

  const save = () => {
    saveConfig(draft);
    onChange();
    setMsg('Saved on this device.');
  };

  const exportBackup = async () => {
    const dump: Record<string, unknown> = {};
    for (const t of db.tables) dump[t.name] = await t.toArray();
    const blob = new Blob([JSON.stringify({ exportedAt: Date.now(), config, data: dump }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `openpos-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'config.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="settings">
      <div className="card form">
        <h3>Branding (white-label)</h3>
        <label>App name<input value={draft.appName} onChange={(e) => set('appName', e.target.value)} /></label>
        <label>Tagline<input value={draft.tagline} onChange={(e) => set('tagline', e.target.value)} /></label>
        <label>Brand colour<input type="color" value={draft.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} /></label>
        <label>Currency symbol<input value={draft.currencySymbol} onChange={(e) => set('currencySymbol', e.target.value)} /></label>
        <label>Locale (number format)<input value={draft.locale} onChange={(e) => set('locale', e.target.value)} /></label>
        <label>
          {t('settings.language')} / Language
          <select value={draft.language} onChange={(e) => set('language', e.target.value)}>
            {(Object.keys(LANGUAGES) as Lang[]).map((l) => <option key={l} value={l}>{LANGUAGES[l]}</option>)}
          </select>
        </label>
        <label>Voice language<input value={draft.speechLang} onChange={(e) => set('speechLang', e.target.value)} /></label>
      </div>

      <div className="card form">
        <h3>Features for this deployment</h3>
        <div className="row-btns">
          {(Object.keys(presets) as (keyof typeof presets)[]).map((p) => (
            <button key={p} onClick={() => setDraft({ ...draft, ...presets[p], features: { ...draft.features, ...presets[p].features! } })}>
              {p[0]!.toUpperCase() + p.slice(1)} preset
            </button>
          ))}
        </div>
        {(Object.keys(draft.features) as (keyof AppConfig['features'])[]).map((k) => (
          <label className="check" key={k}>
            <input type="checkbox" checked={draft.features[k]} onChange={() => flag(k)} /> {k}
          </label>
        ))}
        <label className="check">
          <input type="checkbox" checked={draft.allowNegativeStock} onChange={(e) => set('allowNegativeStock', e.target.checked)} /> Allow selling below zero stock
        </label>
      </div>

      <Shops isAdmin={isAdmin || !serverMode()} />

      <PrinterSetup draft={draft} onChange={(printer) => setDraft({ ...draft, printer })} />

      <VoiceSetup engine={draft.speechEngine} onEngine={(e) => set('speechEngine', e)} />

      <div className="card form">
        <h3>Voice assistant: smart fallback (optional)</h3>
        <p className="small muted">Common commands work offline with no AI. This only helps with unusual phrasing.</p>
        <label>
          Provider
          <select value={draft.llm.provider} onChange={(e) => llm('provider', e.target.value)}>
            <option value="none">None (rules only)</option>
            <option value="ollama">Ollama (local, works offline)</option>
            <option value="gemini">Google Gemini (free tier, online)</option>
          </select>
        </label>
        {draft.llm.provider === 'ollama' && (
          <>
            <label>Ollama URL<input value={draft.llm.ollamaUrl} onChange={(e) => llm('ollamaUrl', e.target.value)} /></label>
            <label>Model<input value={draft.llm.ollamaModel} onChange={(e) => llm('ollamaModel', e.target.value)} /></label>
          </>
        )}
        {draft.llm.provider === 'gemini' && (
          <>
            <label>API key<input type="password" value={draft.llm.geminiKey} onChange={(e) => llm('geminiKey', e.target.value)} /></label>
            <label>Model<input value={draft.llm.geminiModel} onChange={(e) => llm('geminiModel', e.target.value)} /></label>
            <p className="small muted">The key is stored only on this device.</p>
          </>
        )}
      </div>

      <div className="card form">
        <h3>Server &amp; sync</h3>
        <p className="small muted">
          Leave empty to work on this device only. With a server, all your devices share one set of products, stock and sales, and
          sign in with their own accounts.
        </p>
        <label>
          Server address
          <input value={draft.serverUrl} onChange={(e) => set('serverUrl', e.target.value)} placeholder="https://192.168.1.10:8787" />
        </label>
        <div className="row-btns">
          <button onClick={() => set('serverUrl', window.location.origin)}>Use this website's address</button>
          {serverMode() && (
            <button
              onClick={async () => {
                try {
                  const r = await syncNow();
                  setMsg(r.note ?? `Sent ${r.pushed}, received ${r.pulled}${r.rejected ? `, ${r.rejected} refused by server` : ''}.`);
                } catch (e) {
                  setMsg(e instanceof Error ? e.message : 'Sync failed');
                }
              }}
            >
              Sync now
            </button>
          )}
        </div>
        <p className="small muted">Changing the server address asks you to sign in again. Save settings to apply it.</p>
      </div>

      {account}
      {isAdmin && serverMode() && getSession()?.isSuper && <Businesses call={(m, p, b) => api(m, p, b, getSession()!.token)} />}
      {isAdmin && serverMode() && getSession() && <Users call={(m, p, b) => api(m, p, b, getSession()!.token)} />}

      <div className="card form">
        <h3>Data</h3>
        <button onClick={async () => { await seedDemo(); setMsg('Demo data loaded (only if there were no products).'); }}>Load demo data</button>
        <button onClick={exportBackup}>Download full backup (JSON)</button>
        <button onClick={exportConfig}>Download config.json for deployment</button>
      </div>

      <div className="savebar">
        {msg && <span className="muted">{msg}</span>}
        <button className="primary" onClick={save}>Save settings</button>
      </div>
    </div>
  );
}
