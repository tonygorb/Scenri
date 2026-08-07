import { useCallback, useEffect, useState } from 'react';
import { api, type ShowcaseEntry } from './api.js';

export interface ShowcaseData {
  showcase: ShowcaseEntry[];
  categories: string[];
  /** True once the fetch has settled, success or failure. False also while a refetch is in flight. */
  loaded: boolean;
  /** True only if the fetch settled by failing. */
  error: boolean;
}

export interface UseShowcaseResult extends ShowcaseData {
  refetch: () => void;
}

const EMPTY: ShowcaseData = { showcase: [], categories: [], loaded: false, error: false };

/**
 * The curated homepage showcase, asked for once for the whole app — same
 * shape as `useScenes`/`usePresenters`. Home renders it as the gallery grid;
 * Create resolves a clicked entry's exact recipe from it via `?showcase=`.
 */
export function useShowcase(): UseShowcaseResult {
  const [data, setData] = useState<ShowcaseData>(EMPTY);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    void api
      .showcase()
      .then((r) => {
        if (alive) setData({ showcase: r.showcase, categories: r.categories, loaded: true, error: false });
      })
      .catch(() => {
        if (alive) setData((d) => ({ ...d, loaded: true, error: true }));
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  const refetch = useCallback(() => {
    setData((d) => ({ ...d, loaded: false, error: false }));
    setTick((t) => t + 1);
  }, []);

  return { ...data, refetch };
}
