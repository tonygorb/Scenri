import { useEffect, useState } from 'react';

/**
 * The one phone breakpoint. Matches the 767px boundary `tokens.css` already
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
