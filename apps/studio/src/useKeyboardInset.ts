import { useEffect } from 'react';

/** Below this a change is browser chrome sliding about, not a keyboard. */
const FLOOR = 60;

/**
 * Publishes the height the software keyboard is covering as `--bt-kb`.
 *
 * iOS leaves the layout viewport alone and shrinks only the visual one, so a
 * `position: fixed` dock keeps its bottom offset and ends up underneath the
 * keyboard: you type into a composer you cannot see. There is no CSS unit for
 * this, so the number has to be measured. Chrome Android resizes the layout
 * viewport itself (`interactive-widget=resizes-content`), where the maths below
 * comes out at 0 and nothing moves.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;

    const apply = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      root.style.setProperty('--bt-kb', covered > FLOOR ? `${Math.round(covered)}px` : '0px');
    };

    apply();
    vv.addEventListener('resize', apply);
    // the visual viewport also scrolls under the keyboard on iOS
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      root.style.removeProperty('--bt-kb');
    };
  }, []);
}
