import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

/**
 * The two things every panel in the bar owes, and the two its panels kept
 * getting wrong one at a time.
 *
 * The bar outlives the screen, so a panel left open would follow you to the next
 * page. And a dialog taking the screen closes whatever floats in a corner: two
 * floating surfaces at once, and the one the person just asked for wins.
 */
export function useBarPanel(open: boolean, close: () => void): void {
  const { pathname } = useLocation();
  // The closer is read through a ref so navigating is the only thing that
  // triggers the first effect: with `close` in its deps, any parent render
  // would close an open panel.
  const latest = useRef(close);
  latest.current = close;

  useEffect(() => {
    latest.current();
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onModal = () => latest.current();
    window.addEventListener('scenri:modal-open', onModal);
    return () => window.removeEventListener('scenri:modal-open', onModal);
  }, [open]);
}
