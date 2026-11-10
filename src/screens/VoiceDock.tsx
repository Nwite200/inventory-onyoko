import { useEffect, useRef, useState } from 'react';
import { config } from '../config';
import { VoiceAgent, type Role } from '../voice/agent';
import { buildFallback } from '../voice/llm';
import { speak, type SttEngine } from '../voice/speech';
import { offlineStt } from '../voice/offlineStt';
import { canFallBackToOffline, pickEngine } from '../voice/engine';
import { loadHint } from '../voice/hint';

interface Line {
  who: 'you' | 'bot';
  text: string;
}
type Mode = 'idle' | 'loading' | 'listening' | 'transcribing';

const HINTS = ['Sell two rice to Mama Ade, cash', 'Add fifty cartons of indomie', 'How many coke do I have?', "What's running low?", 'What did I sell today?'];

// extra examples for people who can buy stock and move it between shops
const MANAGER_HINTS = ['Received 20 rice from Dangote at 41000 each, paid 500000', 'How much do I owe?', 'Transfer 5 rice to Ikeja branch'];

const STATUS: Record<Mode, string> = {
  idle: '',
  loading: 'Getting the voice engine ready…',
  listening: 'Listening… speak now',
  transcribing: 'Working out what you said…',
};

export function VoiceDock({ role }: { role: Role }) {
  const roleRef = useRef(role);
  roleRef.current = role;
  const agent = useRef<VoiceAgent | undefined>(undefined);
  if (!agent.current) agent.current = new VoiceAgent(() => roleRef.current, buildFallback());

  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<Line[]>([]);
  const [text, setText] = useState('');
  const [heard, setHeard] = useState('');
  const [mode, setMode] = useState<Mode>('idle');
  const [level, setLevel] = useState(0);
  const [engineName, setEngineName] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [talk, setTalk] = useState(true);
  const stopRef = useRef<(() => void) | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [log, heard]);
  useEffect(() => {
    return () => {
      stopRef.current?.();
    };
  }, []);

  const bot = (t: string) => setLog((l) => [...l, { who: 'bot', text: t }]);

  const send = async (raw: string, source: 'voice' | 'text') => {
    const t = raw.trim();
    if (!t) return;
    agent.current!.setFallback(buildFallback()); // pick up Settings changes
    setLog((l) => [...l, { who: 'you', text: t }]);
    const r = await agent.current!.handle(t, source);
    bot(r.text);
    setPending(r.pending);
    if (talk) speak(r.text, config.speechLang);
  };

  const run = async (engine: SttEngine, isRetry: boolean): Promise<void> => {
    setEngineName(engine.id === 'offline' ? 'on this device' : 'online');
    const hint = engine.id === 'offline' ? await loadHint() : undefined;
    let gotText = false;
    setHeard('');
    setMode('loading');
    stopRef.current = engine.start(
      config.speechLang,
      {
        onText: (t, final) => {
          setHeard(final ? '' : t);
          if (final) {
            gotText = true;
            void send(t, 'voice');
          }
        },
        onState: setMode,
        onLevel: setLevel,
        onEnd: (err) => {
          setMode('idle');
          setHeard('');
          setLevel(0);
          stopRef.current = undefined;
          if (!err || gotText || err === 'no-speech' || err === 'aborted') return;
          void (async () => {
            if (err === 'unclear') return bot("I couldn't hear that clearly. Try again a little closer to the microphone, or type it.");
            if (engine.id === 'browser' && (err === 'network' || err === 'service-not-allowed') && !isRetry && (await canFallBackToOffline())) {
              bot('No internet for voice, so I switched to on-device voice. Tap the microphone again if it did not start.');
              return run(offlineStt, true);
            }
            if (err === 'network') return bot('Voice needs internet with this browser. Type the command, or set up offline voice in Settings.');
            if (err === 'not-allowed') return bot('Microphone access was blocked. Allow the microphone for this site in your browser, then try again.');
            bot(err);
          })();
        },
      },
      hint,
    );
  };

  const toggleMic = async () => {
    if (mode === 'listening') {
      stopRef.current?.();
      return;
    }
    if (mode !== 'idle') return;
    const pick = await pickEngine();
    if ('error' in pick) return bot(pick.error);
    await run(pick.engine, false);
  };

  const busy = mode !== 'idle';

  return (
    <div className={`dock ${open ? 'open' : ''}`}>
      {!open ? (
        <button className="fab" onClick={() => setOpen(true)} aria-label="Open voice assistant">
          🎤 Assistant
        </button>
      ) : (
        <div className="dock-panel">
          <div className="dock-head">
            <strong>Voice assistant</strong>
            <label className="small check">
              <input type="checkbox" checked={talk} onChange={(e) => setTalk(e.target.checked)} /> Speak replies
            </label>
            <button onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>
          <div className="log">
            {log.length === 0 && (
              <div className="hints muted small">
                Try:
                {[...HINTS, ...(role !== 'cashier' ? MANAGER_HINTS.filter((_, i) => (i < 2 ? config.features.purchases : config.features.transfers)) : [])].map((h) => (
                  <button key={h} className="chip" onClick={() => void send(h, 'text')}>{h}</button>
                ))}
              </div>
            )}
            {log.map((l, i) => (
              <div key={i} className={`bubble ${l.who}`}>{l.text}</div>
            ))}
            {heard && <div className="bubble you ghost">{heard}…</div>}
            <div ref={endRef} />
          </div>
          {pending && (
            <div className="confirm">
              <div className="small">{pending}</div>
              <div className="row-btns">
                <button className="primary" onClick={() => void send('yes', 'text')}>Confirm</button>
                <button onClick={() => void send('cancel', 'text')}>Cancel</button>
              </div>
            </div>
          )}
          {busy && (
            <div className="voice-status small" role="status">
              <span>{STATUS[mode]}</span>
              {engineName && <span className="muted"> · {engineName}</span>}
              {mode === 'listening' && <div className="meter"><div style={{ width: `${Math.round(level * 100)}%` }} /></div>}
            </div>
          )}
          <form
            className="dock-input"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text, 'text');
              setText('');
            }}
          >
            <button
              type="button"
              className={`mic ${mode === 'listening' ? 'on' : ''}`}
              onClick={() => void toggleMic()}
              disabled={mode === 'loading' || mode === 'transcribing'}
              title={mode === 'listening' ? 'Tap when you are done speaking' : 'Tap and speak'}
              aria-label={mode === 'listening' ? 'Stop listening' : 'Start listening'}
            >
              {mode === 'listening' ? '■' : busy ? '…' : '🎤'}
            </button>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Speak or type a command…" />
            <button className="primary">Send</button>
          </form>
        </div>
      )}
    </div>
  );
}
