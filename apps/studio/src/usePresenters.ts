import { useCallback, useEffect, useRef, useState } from 'react';
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
  /**
   * Read the catalog again. Quiet keeps what is on screen, and `loaded`, until
   * the new answer replaces it, and keeps it if the read fails: for a catalog
   * that has only gained pictures (the library download landing), where
   * falling back to skeletons would be the flash this exists to avoid.
   */
  refetch: (opts?: { quiet?: boolean }) => void;
}

const EMPTY: PresentersData = { presenters: [], categories: [], styles: [], loaded: false, error: false };

/**
 * The presenter catalog, asked for once for the whole app — same shape as
 * `useScenes`, for the same reason: several surfaces want it and it does not
 * change while the server runs.
 */
export function usePresenters(): UsePresentersResult {
  const [data, setData] = useState<PresentersData>(EMPTY);
  const [tick, setTick] = useState(0);
  const quiet = useRef(false);

  useEffect(() => {
    let alive = true;
    void api
      .presenters()
      .then((r) => {
        if (alive)
          setData({ presenters: r.presenters, categories: r.categories, styles: r.styles, loaded: true, error: false });
      })
      .catch(() => {
        if (alive && !quiet.current) setData((d) => ({ ...d, loaded: true, error: true }));
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  const refetch = useCallback((opts?: { quiet?: boolean }) => {
    quiet.current = !!opts?.quiet;
    if (!quiet.current) setData((d) => ({ ...d, loaded: false, error: false }));
    setTick((t) => t + 1);
  }, []);

  return { ...data, refetch };
}
