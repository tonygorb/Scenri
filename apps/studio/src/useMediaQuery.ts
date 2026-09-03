import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * The one phone breakpoint. Matches the 767px boundary `app.css` already
 * uses for `--sc-gutter`, the tab bar and every mobile layout rule, so a
 * component that swaps shells in JS and one that restyles in CSS never
 * disagree by a pixel.
 */
export const PHONE = '(max-width: 767px)';

/** Which shell to render. Watched, not sampled: a rotated phone is a new answer. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/**
 * One MediaQueryList per query for the whole app, read through
 * useSyncExternalStore: a catalog wall of a hundred cards used to hold a
 * hundred lists and a hundred change listeners for the same question.
 */
const shared = new Map<string, { mq: MediaQueryList; subscribe: (cb: () => void) => () => void }>();
function sharedQuery(query: string) {
  let entry = shared.get(query);
  if (!entry) {
    const mq = window.matchMedia(query);
    entry = {
      mq,
      subscribe: (cb) => {
        mq.addEventListener('change', cb);
        return () => mq.removeEventListener('change', cb);
      },
    };
    shared.set(query, entry);
  }
  return entry;
}

/** Whether the primary pointer cannot hover: touch UI, where hover-only controls need a tap to arm. */
export function useHoverNone(): boolean {
  const entry = sharedQuery('(hover: none)');
  return useSyncExternalStore(
    entry.subscribe,
    () => entry.mq.matches,
    () => false,
  );
}
