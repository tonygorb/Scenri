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
  // The counter alone: the moving band already says "generating", and the
  // words beside the number crowded a phone tile into noise. The escalating
  // phrase still reaches assistive tech, where the band says nothing. A timer,
  // not a status: a status is a polite live region, and a label that changes
  // every second made each running tile a voice that could speak every tick.
  // The Create screen's one live region says when a shot starts and lands.
  return (
    <span className="sc-cell-tag" role="timer" aria-label={`${runningPhrase(since, now)}, ${elapsedLabel(since, now)}`}>
      {elapsedLabel(since, now)}
    </span>
  );
}
