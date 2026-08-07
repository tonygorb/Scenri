import { useCallback, useEffect, useState } from 'react';
import { api, type Presenter } from './api.js';

export interface PresentersData {
  presenters: Presenter[];
  categories: string[];
  styles: string[];
  /** True once the fetch has settled, success or failure. False also while a refetch is in flight. */
  loaded: boolean;
  /** True only if the fetch settled by failing. */
  error: boolean;
}

export interface UsePresentersResult extends PresentersData {
  refetch: () => void;
}

const EMPTY: PresentersData = { presenters: [], categories: [], styles: [], loaded: false, error: false };

/**
 * The presenter catalog, asked for once for the whole app — same shape as
 * `useLooks`, for the same reason: several surfaces want it and it does not
 * change while the server runs.
 */
export function usePresenters(): UsePresentersResult {
  const [data, setData] = useState<PresentersData>(EMPTY);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    void api
      .presenters()
      .then((r) => {
        if (alive)
          setData({ presenters: r.presenters, categories: r.categories, styles: r.styles, loaded: true, error: false });
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
