import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** The four-module margin every scanner expects around a code. */
const QUIET = 4;

/**
 * A QR code, drawn here from the text: nothing is sent anywhere to make it.
 * Always dark modules on a light plate, whatever the theme, because phone
 * cameras read the inverted code poorly or not at all (`.sc-qr` in
 * settings.css). One path, so it stays sharp at any size.
 */
export function QrCode({ value, label, size = 200 }: { value: string; label: string; size?: number }) {
  const { side, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (qr.isDark(row, col)) d += `M${col + QUIET} ${row + QUIET}h1v1h-1z`;
      }
    }
    return { side: n + QUIET * 2, path: d };
  }, [value]);
  return (
    <svg
      className="sc-qr"
      viewBox={`0 0 ${side} ${side}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect className="sc-qr-plate" width={side} height={side} />
      <path className="sc-qr-ink" d={path} />
    </svg>
  );
}
