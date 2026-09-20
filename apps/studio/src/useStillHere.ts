import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

/**
 * Whether the page that started a write is still the page on screen when the
 * write answers.
 *
 * A delete, a save or a create resolves after an await, and by then the person
 * may have left: pressed Back, opened another page, or switched brand (which
 * keeps the rest of the path, so a scene page can stay mounted under a
 * different brand). The answer is still applied wherever it came from, because
 * it is the truth about what exists. What must not happen is the navigation
 * that followed it, pulling the person back to a place they already left.
 *
 * Call the returned function when the write starts; the checker it hands back
 * answers for that moment.
 */
export function useStillHere(): () => () => boolean {
  const { pathname } = useLocation();
  const live = useRef({ mounted: false, pathname });
  live.current.pathname = pathname;
  useEffect(() => {
    live.current.mounted = true;
    return () => {
      live.current.mounted = false;
    };
  }, []);
  return useCallback(() => {
    const started = live.current.pathname;
    return () => live.current.mounted && live.current.pathname === started;
  }, []);
}
