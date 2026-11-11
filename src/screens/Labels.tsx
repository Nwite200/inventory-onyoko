import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { assignMissingSkus, setSku } from '../actions';
import { formatMoney } from '../config';
import { encode } from '../printing/code128';
import { printLabels } from '../printing/print';
import { config } from '../config';

/** The bars of a barcode as an SVG that scales to any label size (with the quiet zone scanners need). */
export function BarcodeSvg({ code }: { code: string }) {
  const bars = encode(code);
  const quiet = 10;
  let d = '';
  for (let i = 0; i < bars.length; ) {
    if (bars[i] === '1') {
      let j = i;
      while (bars[j] === '1') j++;
      d += `M${i + quiet} 0h${j - i}v1h-${j - i}z`;
      i = j;
    } else i++;
  }
  return (
    <svg viewBox={`0 0 ${bars.length + quiet * 2} 1`} preserveAspectRatio="none" className="barcode" role="img" aria-label={`Barcode ${code}`}>
      <path d={d} fill="#000" />
    </svg>
  );
}

/** Choose products and how many labels of each, then print them on a sheet or on the receipt printer. */
export function Labels({ onClose }: { onClose: () => void }) {
  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), [], []);
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [w, setW] = useState(50);
  const [h, setH] = useState(30);
  const [cols, setCols] = useState(3);
  const [msg, setMsg] = useState('');
  const direct = config.printer.mode !== 'browser';
  useEffect(() => {
    document.body.classList.add('printing-labels'); // makes the print stylesheet print only the label sheet
    return () => document.body.classList.remove('printing-labels');
  }, []);

  const withCode = products.filter((p) => p.sku);
  const without = products.filter((p) => !p.sku);
  const chosen = useMemo(
    () => withCode.flatMap((p) => Array.from({ length: Math.min(copies[p.id] ?? 0, 200) }, () => p)),
    [withCode, copies],
  );

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg('');
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'That did not work');
    }
  };

  return (
    <div className="modal">
      <div className="card labels-dialog">
        <div className="no-print">
          <h3>Barcode labels</h3>
          {without.length > 0 && (
            <p className="small">
              {without.length} product{without.length === 1 ? ' has' : 's have'} no barcode yet.{' '}
              <button onClick={() => void run(async () => { await assignMissingSkus(); }, 'Barcodes added.')}>Give them barcodes</button>
            </p>
          )}
          <div className="table-wrap" style={{ maxHeight: 220, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Product</th><th>Barcode</th><th>Labels</th></tr></thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>
                      <input
                        aria-label={`Barcode for ${p.name}`}
                        defaultValue={p.sku}
                        style={{ width: 150 }}
                        onBlur={(e) => { if (e.target.value.trim() !== p.sku) void run(async () => { await setSku(p.id, e.target.value); }, ''); }}
                      />
                    </td>
                    <td>
                      <input aria-label={`Labels for ${p.name}`} className="narrow" type="number" min="0" max="200" disabled={!p.sku} value={copies[p.id] ?? 0}
                        onChange={(e) => setCopies({ ...copies, [p.id]: Math.max(0, Number(e.target.value) || 0) })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row-btns" style={{ margin: '8px 0' }}>
            <button onClick={() => setCopies(Object.fromEntries(withCode.map((p) => [p.id, 1])))}>1 label each</button>
            <button onClick={() => setCopies({})}>Clear</button>
            <label className="small">Label width (mm) <input className="narrow" type="number" value={w} onChange={(e) => setW(Number(e.target.value) || 50)} /></label>
            <label className="small">height (mm) <input className="narrow" type="number" value={h} onChange={(e) => setH(Number(e.target.value) || 30)} /></label>
            <label className="small">per row <input className="narrow" type="number" min="1" value={cols} onChange={(e) => setCols(Math.max(1, Number(e.target.value) || 1))} /></label>
          </div>
          {msg && <p className="small" role="status">{msg}</p>}
          <div className="actions">
            {direct && (
              <button disabled={chosen.length === 0} onClick={() => void run(() => printLabels(withCode.filter((p) => copies[p.id]).map((p) => ({ item: p, copies: copies[p.id]! }))), 'Sent to the printer.')}>
                Print on receipt printer
              </button>
            )}
            <button className="primary" disabled={chosen.length === 0} onClick={() => window.print()}>Print sheet ({chosen.length})</button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="label-sheet" style={{ gridTemplateColumns: `repeat(${cols}, ${w}mm)` }}>
          {chosen.map((p, i) => (
            <div className="label" key={i} style={{ width: `${w}mm`, height: `${h}mm` }}>
              <div className="label-name">{p.name}</div>
              <BarcodeSvg code={p.sku} />
              <div className="label-foot"><span>{p.sku}</span><strong>{formatMoney(p.price)}</strong></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
