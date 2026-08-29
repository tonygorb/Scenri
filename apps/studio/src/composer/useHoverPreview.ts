import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The open/close timing behind a hover preview.
 *
 * Two delays, for two different mistakes. Without the open delay, sweeping a
 * pointer across a sentence to reach the Generate button flashes a card at
 * every chip on the way. Without the close delay, the 8px between a chip and
 * its own card is a hole the pointer falls through, so the card cannot be
 * reached to click.
 *
 * Once something is already showing, moving to another chip switches at once:
 * a delay there would read as lag, not as intent, which is how every hover
 * card on the web behaves and what `CreditTip` already does with no delay at
 * all on the showcase wall.
 */
const OPEN_MS = 160;
const CLOSE_MS = 120;

export interface HoverPreview<T> {
  shown: T | null;
  /** Ask for `next`, after the intent delay, or at once if a card is already up. */
  open: (next: T) => void;
  /** The pointer arrived somewhere that counts as still hovering: cancel a pending close. */
  keep: () => void;
  /** The pointer left. Close, unless it comes back within the grace. */
  close: () => void;
  /** Escape, a click, a removal: gone this frame, no grace. */
  closeNow: () => void;
}

export function useHoverPreview<T>(): HoverPreview<T> {
  const [shown, setShown] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showing = useRef(false);
  showing.current = shown !== null;

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const open = useCallback(
    (next: T) => {
      stop();
      if (showing.current) {
        setShown(next);
        return;
      }
      timer.current = setTimeout(() => setShown(next), OPEN_MS);
    },
    [stop],
  );

  const close = useCallback(() => {
    stop();
    timer.current = setTimeout(() => setShown(null), CLOSE_MS);
  }, [stop]);

  const closeNow = useCallback(() => {
    stop();
    setShown(null);
  }, [stop]);

  // A pending open must not fire into an unmounted composer.
  useEffect(() => stop, [stop]);

  return { shown, open, keep: stop, close, closeNow };
}
