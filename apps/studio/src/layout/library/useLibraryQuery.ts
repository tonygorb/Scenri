import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

/**
 * One URL-backed query object per library page: a free-text `q` plus
 * however many named facets that page needs (Products: category. Scenes:
 * vertical. Presenters: category + style). Deliberately owns `useSearchParams`
 * directly rather than composing several `useFilterParam` calls — each of
 * those writes independently from the same stale `location.search` closure,
 * so calling two in one handler (e.g. "Clear filters" resetting both search
 * and a facet) has the second call silently undo the first. Every change
 * here goes through one `update()`, one `URLSearchParams`, one write.
 */
export function useLibraryQuery(facetKeys: string[]) {
  const [params, setParams] = useSearchParams();

  const q = params.get('q') ?? '';
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

  const setQ = useCallback((next: string) => update({ q: next }), [update]);
  const setFacet = useCallback((key: string, next: string | null) => update({ [key]: next }), [update]);

  const active = q.trim().length > 0 || Object.values(facets).some(Boolean);

  const clear = useCallback(() => {
    const patch: Record<string, string | null> = { q: null };
    for (const key of facetKeysStable.split(',').filter(Boolean)) patch[key] = null;
    update(patch);
  }, [update, facetKeysStable]);

  return { q, setQ, facets, setFacet, active, clear };
}
