import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

/**
 * Long enough that a burst of typing is one write, short enough that the URL
 * is already correct by the time a hand leaves the keyboard to copy the link.
 */
const WRITE_DELAY = 150;

/**
 * One URL-backed query object per library page: a free-text `q` plus
 * however many named facets that page needs (Products: category. Scenes:
 * vertical. Presenters: category + style). Deliberately owns `useSearchParams`
 * directly rather than composing several `useFilterParam` calls — each of
 * those writes independently from the same stale `location.search` closure,
 * so calling two in one handler (e.g. "Clear filters" resetting both search
 * and a facet) has the second call silently undo the first. Every change
 * here goes through one `update()`, one `URLSearchParams`, one write.
 *
 * `q` is answered from local state and only *written* to the URL on a trailing
 * timer. A controlled input whose value round-trips through the router pays a
 * navigation and a re-render of the whole route tree per keystroke, which on a
 * 576-product brand is felt as input lag. Filtering still runs on every
 * keystroke — results stay live — it is only the address bar that lags, and
 * only by `WRITE_DELAY`.
 */
export function useLibraryQuery(facetKeys: string[]) {
  const [params, setParams] = useSearchParams();

  const urlQ = params.get('q') ?? '';
  const facetKeysStable = facetKeys.join(',');
  const facets = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const key of facetKeysStable.split(',').filter(Boolean)) out[key] = params.get(key) || null;
    return out;
  }, [params, facetKeysStable]);

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (cur) => {
          const p = new URLSearchParams(cur);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === '') p.delete(key);
            else p.set(key, value);
          }
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const [q, setDraft] = useState(urlQ);
  /** The last `q` this hook itself put in the URL, so it can tell its own echo from someone else's write. */
  const written = useRef(urlQ);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // Someone else moved the URL — a fresh link, a route change, a Clear from
  // outside this hook. Whatever write was queued is stale by definition.
  useEffect(() => {
    if (urlQ === written.current) return;
    written.current = urlQ;
    cancel();
    setDraft(urlQ);
  }, [urlQ, cancel]);

  // A queued write must not outlive the page that queued it.
  useEffect(() => cancel, [cancel]);

  const setQ = useCallback(
    (next: string) => {
      setDraft(next);
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        written.current = next;
        update({ q: next || null });
      }, WRITE_DELAY);
    },
    [update, cancel],
  );

  const setFacet = useCallback((key: string, next: string | null) => update({ [key]: next }), [update]);

  const active = q.trim().length > 0 || Object.values(facets).some(Boolean);

  const clearSearch = useCallback(() => {
    cancel();
    setDraft('');
    written.current = '';
    update({ q: null });
  }, [update, cancel]);

  const clear = useCallback(() => {
    cancel();
    setDraft('');
    written.current = '';
    const patch: Record<string, string | null> = { q: null };
    for (const key of facetKeysStable.split(',').filter(Boolean)) patch[key] = null;
    update(patch);
  }, [update, cancel, facetKeysStable]);

  return { q, setQ, facets, setFacet, active, clearSearch, clear };
}
