import { useCallback, useEffect, useState } from 'react';
import { api, type Look } from './api.js';

export interface LooksData {
  looks: Look[];
  collections: string[];
  verticals: string[];
  /** True once the fetch has settled, success or failure. False also while a refetch is in flight. */
  loaded: boolean;
  /** True only if the fetch settled by failing. */
  error: boolean;
}

export interface UseLooksResult extends LooksData {
  refetch: () => void;
}

const EMPTY: LooksData = { looks: [], collections: [], verticals: [], loaded: false, error: false };

/**
 * The look catalog, asked for once for the whole app. Eight surfaces want it
 * and it does not change while the server runs, so one ask in the shell beats
 * eight that refire on every navigation.
 */
export function useLooks(): UseLooksResult {
  const [data, setData] = useState<LooksData>(EMPTY);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    void api
      .looks()
      .then((r) => {
        if (alive)
          setData({ looks: r.looks, collections: r.collections, verticals: r.verticals, loaded: true, error: false });
      })
      .catch(() => {
        // a failed fetch is not the same as a still-loading one, and must not
        // silently look like an empty catalog forever
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
