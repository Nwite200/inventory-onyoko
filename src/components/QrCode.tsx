import qrcode from 'qrcode-generator';

/** Offline QR renderer. The module data is generated on the device, no image service. */
export function QrCode({ text, size = 120, className }: { text: string; size?: number; className?: string }) {
  if (!text.trim()) return null;
  const qr = qrcode(0, 'M');
  qr.addData(text.slice(0, 900));
  qr.make();
  const count = qr.getModuleCount();
  const cell = size / count;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className} role="img" aria-label="QR code">
      <rect width={size} height={size} fill="#fff" />
      {Array.from({ length: count }, (_, row) =>
        Array.from({ length: count }, (_, col) =>
          qr.isDark(row, col) ? <rect key={`${row}-${col}`} x={col * cell} y={row * cell} width={cell + 0.3} height={cell + 0.3} fill="#0b1220" /> : null,
        ),
      )}
    </svg>
  );
}
