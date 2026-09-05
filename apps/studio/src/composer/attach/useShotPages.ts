import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type FeedNode } from '../../api.js';

/** Shots per page: the same page the picker turns for every other kind. */
export const SHOT_PAGE = 48;

export interface ShotPages {
  /** Finished shots with a picture, newest first, as many pages as were asked for. */
  items: FeedNode[];
  /** How many shots the search reaches, whatever their state; the header's number. */
  total: number;
  /** A further page exists. */
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  loadMore: () => void;
}

const EMPTY: ShotPages = { items: [], total: 0, hasMore: false, loading: false, error: null, loadMore: () => {} };

/**
 * Every shot of the brand for the picker's Shots tab, a page at a time.
 *
 * The workspace answer carries a shelf of recent shots for the rail; the
 * picker used to read that shelf and cut it to twelve, so a brand with four
 * hundred shots offered twelve. This is the feed's own query instead, the one
 * the Create grid turns: newest first, searched on the server, keyset paged.
 * A shot still rendering, failed or empty is not a reference and is left out
 * of what is drawn, never of the count.
 */
export function useShotPages(brandId: string, query: string): ShotPages {
  const q = query.trim();
  const key = `${brandId}|${q}`;
  const [held, setHeld] = useState<{ key: string; items: FeedNode[]; next: string | null; total: number }>({
    key: '',
    items: [],
    next: null,
    total: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      inflight.current?.abort();
      const ctl = new AbortController();
      inflight.current = ctl;
      setLoading(true);
      setError(null);
      try {
        const page = await api.feed(
          brandId,
          { lens: 'all', sort: 'newest', q, limit: SHOT_PAGE, cursor: cursor ?? undefined },
          ctl.signal,
        );
        if (ctl.signal.aborted) return;
        setHeld((cur) => {
          const fresh = cursor === null || cur.key !== key;
          return {
            key,
            items: fresh ? page.items : [...cur.items, ...page.items],
            next: page.next,
            total: page.counts?.all ?? (fresh ? page.items.length : cur.total),
          };
        });
      } catch (e) {
        if (ctl.signal.aborted) return;
        setError(String((e as Error).message ?? e));
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    },
    [brandId, q, key],
  );

  // The first page for a new brand or a new search. Typing is debounced the
  // way the library's URL write is; opening is not.
  useEffect(() => {
    const delay = held.key === '' ? 0 : 150;
    const t = setTimeout(() => void fetchPage(null), delay);
    return () => clearTimeout(t);
    // held.key is read for the delay only; a new key is what should refetch
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  }, [fetchPage]);

  useEffect(() => () => inflight.current?.abort(), []);

  const current = held.key === key ? held : null;
  const loadMore = useCallback(() => {
    if (current?.next) void fetchPage(current.next);
  }, [current?.next, fetchPage]);

  if (!current) return { ...EMPTY, loading, error, loadMore };
  return {
    items: current.items.filter((s) => s.status === 'done' && s.images.length > 0),
    total: current.total,
    hasMore: current.next !== null,
    loading,
    error,
    loadMore,
  };
}
