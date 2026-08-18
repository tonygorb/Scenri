/** Matches the content fade in app.css. See `useShape`. */
const FADE_MS = 130;

import { useEffect, useState } from 'react';

export type Shape = 'compact' | 'open';

/**
 * What a section is doing while the column is in whatever state it is in.
 *
 * `idle` — nothing is open anywhere, so every section shows its quick row and
 * the whole shelf is readable at a glance. `open` — this one is being used, so
 * it takes the height. `collapsed` — a sibling is open, so this one gives its
 * row back and waits as a header. `result` — a search is live, so every
 * section shows what it found and the rail scrolls through the answers.
 *
 * That third mode is the point. Height in a 320px column is the scarce thing:
 * four other quick rows are 280px that the section you are actually working in
 * could be using, and they are not being looked at while you work in it.
 */
export type SectionMode = 'idle' | 'open' | 'collapsed' | 'result';

export function useShape(want: Shape): Shape {
  const [shown, setShown] = useState(want);
  useEffect(() => {
    if (want === shown) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(want);
      return;
    }
    const t = setTimeout(() => setShown(want), FADE_MS);
    return () => clearTimeout(t);
  }, [want, shown]);
  return shown;
}

/**
 * The shared shell: a header, and a body that changes shape under it.
 *
 * The caret is invisible until the header is hovered or focused — a disclosure
 * control that is always showing is permanent noise for something you do once
 * a section. It stays visible on touch, where there is no hover to reveal it,
 * and the header itself is the button either way, so `aria-expanded` carries
 * the state whether or not the glyph is drawn.
 */
