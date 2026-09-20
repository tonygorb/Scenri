import { useCallback, useEffect, useRef } from 'react';

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
 * The question is asked of the browser rather than of the last render. React
 * Router 7 moves the URL first and keeps the leaving route painted while the
 * transition settles, so a component's own `useLocation` still reads the old
 * path for those frames. A delete that answered inside that window passed a
 * check written against the render and navigated the person back to the wall
 * they had just left. `window.location` has already moved by then, which is
 * what makes it the honest witness. Mounting is still worth asking about: a
 * route that unmounts without the path changing (a dialog closing over it)
 * leaves nothing to navigate away from.
 *
 * Call the returned function when the write starts; the checker it hands back
 * answers for that moment.
 */
export function useStillHere(): () => () => boolean {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => {
    const started = window.location.pathname;
    return () => mounted.current && window.location.pathname === started;
  }, []);
}
