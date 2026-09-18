/**
 * A ring that fills as a render runs, drawn around the picture it belongs to.
 *
 * The bar's readout has one job while work is in flight: say that it is, and say
 * how far. A linear meter needs a row; a ring needs the picture it is already
 * showing. Queued work keeps the track and no arc, because "nothing has happened
 * yet" and "it is nearly done" must not look alike.
 */
export function ProgressRing({
  value,
  size,
  stroke = 1.5,
}: {
  /** 0 to 1. Anything at or below zero draws the track alone. */
  value: number;
  size: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, value));
  return (
    <svg className="sc-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="sc-ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
      {filled > 0 && (
        <circle
          className="sc-ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - filled)}
          // twelve o'clock, which is where a clock starts and so does this
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
    </svg>
  );
}
