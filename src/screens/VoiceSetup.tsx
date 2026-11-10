import { useEffect, useState } from 'react';
import { offlineSpeech, type Progress } from '../voice/offlineStt';
import { browserStt } from '../voice/speech';
import type { EngineChoice } from '../voice/engine';
import { INSECURE_MESSAGE, isSecure } from '../secure';

const mb = (n: number): string => `${Math.round(n / 1e6)} MB`;

export function VoiceSetup({ engine, onEngine }: { engine: EngineChoice; onEngine: (e: EngineChoice) => void }) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [server, setServer] = useState<{ sizeBytes: number } | { error: string } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    setInstalled(await offlineSpeech.installed());
    try {
      setServer(await offlineSpeech.availableOnServer());
    } catch (e) {
      setServer({ error: e instanceof Error ? e.message : 'Could not reach the server' });
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const download = async () => {
    setBusy(true);
    setError('');
    setProgress({ loaded: 0, total: 1 });
    try {
      await offlineSpeech.prepare(setProgress);
      setInstalled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed. Check your connection and try again.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const secure = isSecure();
  const supported = secure && offlineSpeech.isBrowserSupported();
  const pct = progress && progress.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;

  return (
    <div className="card form">
      <h3>Voice: speech recognition</h3>
      <label>
        Which to use
        <select value={engine} onChange={(e) => onEngine(e.target.value as EngineChoice)}>
          <option value="auto">Automatic (online voice when connected, on-device when offline)</option>
          <option value="offline">Always on-device (works without internet)</option>
          <option value="browser">Always browser voice (needs internet)</option>
        </select>
      </label>

      <div className="small">
        <div>
          Browser voice: {browserStt.isSupported() ? 'available' : 'not supported in this browser'}
          <span className="muted"> · sends audio to the browser maker, needs internet</span>
        </div>
        <div>
          On-device voice:{' '}
          {!secure ? (
            <strong className="warn-text">switched off: this page is not https</strong>
          ) : !supported ? (
            <strong className="warn-text">not supported in this browser</strong>
          ) : installed === null ? (
            'checking…'
          ) : installed ? (
            <strong>ready, works without internet</strong>
          ) : (
            <strong className="warn-text">not downloaded on this device yet</strong>
          )}
        </div>
      </div>

      {!secure && <p className="error small">{INSECURE_MESSAGE}</p>}

      {supported && installed === false && server && 'sizeBytes' in server && (
        <>
          <p className="small muted">
            One-time download of {mb(server.sizeBytes)} from your own server. After that it works with no internet and nothing you say leaves this device.
          </p>
          <button className="primary" onClick={() => void download()} disabled={busy}>
            {busy ? 'Downloading…' : 'Download offline voice'}
          </button>
        </>
      )}
      {supported && installed === false && server && 'error' in server && <p className="error small">{server.error}</p>}
      {busy && progress && (
        <div>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${pct}%` }} /></div>
          <div className="small muted">{pct < 100 ? `${pct}% (${mb(progress.loaded)} of ${mb(progress.total)})` : 'Getting it ready…'}</div>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
      {installed && (
        <button
          className="danger"
          onClick={async () => {
            if (!confirm('Remove the offline voice model from this device? You can download it again later.')) return;
            await offlineSpeech.remove();
            await refresh();
          }}
        >
          Remove from this device
        </button>
      )}
    </div>
  );
}
