import { useEffect, useRef } from 'react';
import { useAppData } from './AppShell.js';

/**
 * Runs `read` each time library pictures have landed since this screen
 * mounted: a record page lists its frames once, and while the first-run
 * download is still bringing them, it lists them again as they arrive,
 * quietly, keeping what it shows. Never on mount: the page's own read does that.
 */
export function useLibraryLanded(read: () => void): void {
  const { libraryTick } = useAppData();
  const seen = useRef(libraryTick);
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => {
    if (libraryTick === seen.current) return;
    seen.current = libraryTick;
    latest.current();
  }, [libraryTick]);
}
