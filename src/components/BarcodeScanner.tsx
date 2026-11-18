import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

interface Detected {
  rawValue: string;
}
interface Detector {
  detect(source: HTMLVideoElement): Promise<Detected[]>;
}
type DetectorCtor = new (options?: { formats?: string[] }) => Detector;

/**
 * Camera barcode scanning using the browser's BarcodeDetector. When the browser or camera is not
 * available the user can still type the code, so a sale is never blocked by device support.
 */
export function BarcodeScanner({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const [supported] = useState(() => typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices);

  useEffect(() => {
    if (!supported) {
      setError('This browser cannot read barcodes from the camera. Type the code below, or use a USB/Bluetooth scanner.');
      return;
    }
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
    const detector = new Ctor({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'itf'] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        await video.play();
        timer = setInterval(() => {
          if (!video || video.readyState < 2) return;
          void detector.detect(video).then((codes) => {
            const code = codes[0]?.rawValue?.trim();
            if (code) {
              onScan(code);
              onClose();
            }
          }).catch(() => undefined);
        }, 350);
      })
      .catch(() => setError('Camera permission was refused or no camera is available. Type the code below.'));
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onScan, onClose, supported]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog scanner-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Scan barcode">
        <header className="modal-header">
          <div><h3>Scan a barcode</h3><p className="panel-sub">Point the camera at the product barcode</p></div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </header>
        <div className="modal-body">
          {supported && !error && <video ref={videoRef} className="scanner-video" muted playsInline />}
          {error && <div className="alert-error">{error}</div>}
          <form
            className="scanner-manual"
            onSubmit={(e) => {
              e.preventDefault();
              const code = manual.trim();
              if (!code) return;
              onScan(code);
              onClose();
            }}
          >
            <label className="field"><span>Or type / paste the barcode</span><input value={manual} onChange={(e) => setManual(e.target.value)} autoFocus placeholder="Barcode number" /></label>
            <button className="btn btn-primary" disabled={!manual.trim()}>Use code</button>
          </form>
        </div>
      </div>
    </div>
  );
}
