import { flushSync } from 'react-dom';

/**
 * Crossfade the filter wall when the browser can do it cheaply.
 * Skip on coarse pointers / reduced motion — VT + flushSync feels laggy there.
 */
export function runTabTransition(update: () => void): void {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => unknown;
  };
  const skip =
    typeof doc.startViewTransition !== 'function' ||
    window.matchMedia('(pointer: coarse)').matches ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (skip) {
    update();
    return;
  }
  doc.startViewTransition(() => {
    flushSync(update);
  });
}
