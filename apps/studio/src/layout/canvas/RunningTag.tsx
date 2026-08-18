import { useEffect, useState } from 'react';
import { elapsedSec, runningPhrase } from '../../tasks.js';

export function RunningTag({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // new Date() read SQLite's zone-less UTC as local time, so this counter used
  // to start at the timezone offset instead of at zero
  return (
    <span className="sc-cell-tag">
      {runningPhrase(since, now)} · {elapsedSec(since, now)}s
    </span>
  );
}
