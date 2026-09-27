import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type FeedCounts, type FeedNode, type FeedQuery } from '../../api.js';
import { useBrand } from '../../app/BrandLayout.js';
import {
  admits,
  appendPage,
  countsAfter,
  insertSorted,
  placeAdmits,
  queryKey,
  refreshFirst,
  replaceById,
  withoutIds,
  type AdmitContext,
} from './feedQueryRules.js';
import { cachedFeed, rememberFeed } from './feedCache.js';

/** Shots per page: about three screens at the large tile, the same page the library walls turn. */
const FEED_PAGE = 60;

interface FeedQueryResult {
  /** The pages loaded so far, in the query's order. Empty while a different brand's answer is still the one held. */
  items: FeedNode[];
  /** The same records by id, for every lookup that used to scan the whole workspace. */
  byId: ReadonlyMap<string, FeedNode>;
  counts: FeedCounts | null;
  /**
   * Whether the pages on screen answer the query asked now. False while a
   * previous answer is being held for the new one to land, so a lens or a
   * keystroke never empties the feed between two round trips.
   */
  ready: boolean;
  loading: boolean;
  /** Every page is in; there is nothing further to bring. */
  complete: boolean;
  error: string | null;
  loadMore: () => void;
  /** A record the pages hold has changed; it moves, stays or goes by the query's rules. */
  patch: (node: FeedNode) => void;
  /** Records that did not exist a moment ago (a send, a refine, a retry). */
  /** Shots arriving; `was` carries what this screen last held for one, so a shot returning from another lens is counted as a move. */
  insert: (nodes: FeedNode[], was?: ReadonlyMap<string, FeedNode>) => void;
  drop: (ids: readonly string[]) => void;
  /** Re-read the first page and the counts, keeping every older page that was loaded. */
  refresh: () => Promise<void>;
  /** Ask for the first page again after it failed. */
  retry: () => void;
}

interface Held {
  brandId: string;
  key: string;
  items: FeedNode[];
  next: string | null;
  counts: FeedCounts | null;
  error: string | null;
}

/**
 * One brand's shots as a paged server query.
 *
 * The client holds only the pages it has scrolled to. Opening a workspace
 * costs one page whatever its size, a lens or a search is a new first page,
 * and every change to a record the pages hold is folded in by the rules in
 * feedQueryRules, never by re-reading the world. The previous answer stays on
 * screen until the next lands; a superseded request is aborted so it can
 * never land on top of a newer one.
 */
export function useFeedQuery(brandId: string, query: FeedQuery, ctx: AdmitContext): FeedQueryResult {
  // A wipe of every shot moves the epoch, and the pages are read again.
  const { shotsEpoch } = useBrand();
  const key = `${queryKey(brandId, query)}#${shotsEpoch}`;
  // A query this session has already met paints what it last held at once;
  // the first page read below replaces it whole (feedCache.ts).
  const [held, setHeld] = useState<Held>(() => {
    const seen = cachedFeed(key);
    return seen ? { ...seen, error: null } : { brandId, key: '', items: [], next: null, counts: null, error: null };
  });
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const heldRef = useRef(held);
  heldRef.current = held;
  const queryRef = useRef(query);
  queryRef.current = query;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const moreInFlight = useRef(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    // A lens or place met before shows what it last held while its page is read.
    const seen = cachedFeed(key);
    if (seen && heldRef.current.key !== key) setHeld({ ...seen, error: null });
    api
      .feed(brandId, { ...queryRef.current, limit: FEED_PAGE }, ctrl.signal)
      .then((page) => {
        if (ctrl.signal.aborted) return;
        setHeld({ brandId, key, items: page.items, next: page.next, counts: page.counts ?? null, error: null });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        const message = String((err as { message?: string })?.message ?? err);
        // Another query's shots are not this one's: what was held for a
        // different lens, place or brand goes, and only this query's own
        // pages (remembered, or read before) stay under the error.
        setHeld((h) =>
          h.key === key
            ? { ...h, error: message }
            : { brandId, key, items: [], next: null, counts: null, error: message },
        );
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [brandId, key, attempt]);

  // Every answer this feed holds is remembered for the next visit; a failed one is not.
  useEffect(() => {
    if (held.key && !held.error) rememberFeed(held);
  }, [held]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const loadMore = useCallback(() => {
    const h = heldRef.current;
    if (h.key !== key || !h.next || moreInFlight.current) return;
    moreInFlight.current = true;
    setLoading(true);
    const cursor = h.next;
    api
      .feed(brandId, { ...queryRef.current, limit: FEED_PAGE, cursor })
      .then((page) => {
        setHeld((cur) =>
          cur.key !== key
            ? cur
            : { ...cur, items: appendPage(cur.items, page.items), next: page.next, counts: page.counts ?? cur.counts },
        );
      })
      .catch(() => {
        /* the next scroll asks again */
      })
      .finally(() => {
        moreInFlight.current = false;
        setLoading(false);
      });
  }, [brandId, key]);

  const refresh = useCallback(async () => {
    const page = await api.feed(brandId, { ...queryRef.current, limit: FEED_PAGE });
    setHeld((cur) =>
      cur.key !== key
        ? cur
        : {
            ...cur,
            items: refreshFirst(cur.items, page.items),
            next: cur.items.length ? cur.next : page.next,
            counts: page.counts ?? cur.counts,
            error: null,
          },
    );
  }, [brandId, key]);

  const patch = useCallback((node: FeedNode) => {
    setHeld((cur) => {
      const before = cur.items.find((n) => n.id === node.id);
      if (!before) return cur;
      const q = queryRef.current;
      const verdict = admits(node, q, ctxRef.current);
      const items = verdict === false ? withoutIds(cur.items, [node.id]) : replaceById(cur.items, node);
      const counts = cur.counts ? countsAfter(cur.counts, before, node, true) : cur.counts;
      return items === cur.items && counts === cur.counts ? cur : { ...cur, items, counts };
    });
  }, []);

  /**
   * Shots arriving into the feed. `was` carries the record this screen last
   * held for one, where it has one: a shot coming back from the archived lens
   * is not an arrival, it is a shot that left one lens for another, and
   * counted as an arrival it added itself to `all` without taking itself out
   * of `archived`, so the tab kept counting it in both.
   */
  const insert = useCallback(
    (nodes: FeedNode[], was?: ReadonlyMap<string, FeedNode>) => {
      let needsRefresh = false;
      setHeld((cur) => {
        let items = cur.items;
        let counts = cur.counts;
        const q = queryRef.current;
        for (const node of nodes) {
          if (items.some((n) => n.id === node.id)) {
            items = replaceById(items, node);
            continue;
          }
          const verdict = admits(node, q, ctxRef.current);
          if (verdict === null) {
            needsRefresh = true;
            continue;
          }
          const inPlace = placeAdmits(node, q, ctxRef.current);
          if (verdict) items = insertSorted(items, node, q.sort, cur.next === null);
          const before = was?.get(node.id) ?? null;
          if (counts) counts = countsAfter(counts, before, node, inPlace);
        }
        return items === cur.items && counts === cur.counts ? cur : { ...cur, items, counts };
      });
      if (needsRefresh) void refresh().catch(() => {});
    },
    [refresh],
  );

  const drop = useCallback((ids: readonly string[]) => {
    setHeld((cur) => {
      const gone = cur.items.filter((n) => ids.includes(n.id));
      if (!gone.length) return cur;
      let counts = cur.counts;
      if (counts) for (const n of gone) counts = countsAfter(counts, n, null, true);
      return { ...cur, items: withoutIds(cur.items, ids), counts };
    });
  }, []);

  const items = held.brandId === brandId ? held.items : [];
  const byId = useMemo(() => new Map(items.map((n) => [n.id, n])), [items]);

  return {
    items,
    byId,
    counts: held.brandId === brandId ? held.counts : null,
    ready: held.key === key && !held.error,
    loading,
    complete: held.key === key && held.next === null,
    error: held.key === key ? held.error : null,
    loadMore,
    patch,
    insert,
    drop,
    refresh,
    retry,
  };
}
