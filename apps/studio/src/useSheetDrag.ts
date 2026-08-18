import { useRef, type PointerEvent } from 'react';

/**
 * The bar at the top is a real handle, not a picture of one: a sheet that
 * shows the affordance and then refuses the gesture is worse than a sheet
 * with no bar at all. Pointer events rather than touch, so a trackpad drag
 * behaves the same as a thumb.
 *
 * Dismiss on distance or a flick: moved > 96 || speed > 0.45 px/ms. A nudge
 * springs back. On dismiss the inline transform stays so the exit animation
 * continues from where the thumb left off.
 */
export function useSheetDrag(onDismiss: () => void) {
  const sheet = useRef<HTMLDivElement>(null);
  const from = useRef<{ y: number; t: number } | null>(null);
  const moved = useRef(0);

  const grab = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    from.current = { y: e.clientY, t: e.timeStamp };
    moved.current = 0;
    if (sheet.current) sheet.current.style.transition = 'none';
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const drag = (e: PointerEvent<HTMLElement>) => {
    if (!from.current || !sheet.current) return;
    // down only: an upward pull has nowhere to go
    moved.current = Math.max(0, e.clientY - from.current.y);
    sheet.current.style.transform = `translateY(${moved.current}px)`;
  };
  const release = (e: PointerEvent<HTMLElement>) => {
    const start = from.current;
    from.current = null;
    if (!start || !sheet.current) return;
    sheet.current.style.transition = '';
    // a short flick is as clear an intention as a long drag
    const speed = moved.current / Math.max(1, e.timeStamp - start.t);
    if (moved.current > 96 || speed > 0.45) {
      // the transform stays put: the exit animation outranks it in the cascade
      // and carries on from where the thumb left off
      onDismiss();
      return;
    }
    sheet.current.style.transform = '';
  };

  return {
    sheet,
    grip: {
      onPointerDown: grab,
      onPointerMove: drag,
      onPointerUp: release,
      onPointerCancel: release,
    },
  };
}
