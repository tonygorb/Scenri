/**
 * A ring around the picture a job belongs to.
 *
 * A known fraction fills the arc. A generation has no honest fraction, so the
 * arc travels instead: a mark that sits still would claim a progress nobody
 * can know. Queued work, a real zero, keeps the track and no arc.
 */
export function ProgressRing({
  value,
  size,
  stroke = 1.5,
  indeterminate = false,
}: {
  /** 0 to 1. Anything at or below zero draws the track alone, unless the ring is indeterminate. */
  value: number;
  size: number;
  stroke?: number;
  /** Working, with no fraction to draw. The arc moves; it does not fill. */
  indeterminate?: boolean;
}) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, value));
  const arc = (dash: string) => (
    <circle
      className="sc-ring-arc"
      cx={size / 2}
      cy={size / 2}
      r={r}
      fill="none"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeDasharray={dash}
      strokeDashoffset={indeterminate ? 0 : circumference * (1 - filled)}
      transform={`rotate(-90 ${size / 2} ${size / 2})`}
    />
  );
  return (
    <svg className="sc-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {!indeterminate && (
        <circle className="sc-ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
      )}
      {indeterminate ? <g className="sc-ring-spin">{arc(`${circumference * 0.28} ${circumference}`)}</g> : null}
      {!indeterminate && filled > 0 ? arc(String(circumference)) : null}
    </svg>
  );
}
