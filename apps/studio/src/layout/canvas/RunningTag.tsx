import { useEffect, useState } from 'react';
import { elapsedLabel, runningPhrase } from '../../tasks.js';

export function RunningTag({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // new Date() read SQLite's zone-less UTC as local time, so this counter used
  // to start at the timezone offset instead of at zero.
  // The counter alone: the shimmer already says "generating", and the words
  // beside the number crowded a phone tile into noise. The escalating phrase
  // still reaches assistive tech, where the shimmer says nothing.
  return (
    <span
      className="sc-cell-tag"
      role="status"
      aria-label={`${runningPhrase(since, now)}, ${elapsedLabel(since, now)}`}
    >
      {elapsedLabel(since, now)}
    </span>
  );
}
