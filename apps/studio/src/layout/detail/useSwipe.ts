import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

/** How far a finger travels sideways before it has said something. */
const SWIPE_PX = 60;

/**
 * A horizontal swipe on a touch surface, told from a scroll by its axis: it
 * fires only when the finger travelled mostly sideways, and never for a
 * mouse. The surface keeps `touch-action: pan-y pinch-zoom`, so a vertical
 * gesture still scrolls and a pinch still zooms the page; this only reads
 * what the browser left for it. A swipe to the left asks for the next thing,
 * the way every photo app reads it.
 */
export function useSwipe({ onLeft, onRight }: { onLeft: () => void; onRight: () => void }) {
  const start = useRef<{ id: number; x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse') return;
      start.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const s = start.current;
      start.current = null;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < 2 * Math.abs(dy)) return;
      if (dx < 0) onLeft();
      else onRight();
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}
