import { useEffect, useState } from 'react';
import { pageSlice } from './libraryRules.js';

const PAGE = 60;

/**
 * Load More over a filtered list. Resets to one page whenever the filtered
 * set's identity changes (a new search term or facet — not just item count
 * shrinking from live data, which stays put so a poll doesn't yank the
 * scroll position back to page one).
 */
export function useLibraryPage<T>(items: T[], resetKey: string) {
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    setShown(PAGE);
  }, [resetKey]);

  const { visible, remaining } = pageSlice(items, shown);
  const showMore = () => setShown((n) => n + PAGE);

  return { visible, remaining, showMore };
}
