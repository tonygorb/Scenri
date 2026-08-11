import { flushSync } from 'react-dom';

/**
 * Run a tab/filter DOM update inside a view transition when the browser
 * supports it, so the wall can crossfade instead of hard-cutting. Falls
 * back to a plain update elsewhere. `flushSync` keeps React 18's paint
 * inside the transition callback.
 */
export function runTabTransition(update: () => void): void {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => unknown;
  };
  if (typeof doc.startViewTransition !== 'function') {
    update();
    return;
  }
  doc.startViewTransition(() => {
    flushSync(update);
  });
}
