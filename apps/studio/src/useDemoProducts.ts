import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type DemoProduct } from './api.js';
import { keepIfSame, release } from './catalogRead.js';

export interface DemoProductsData {
  demoProducts: DemoProduct[];
  categories: string[];
  /** True once the fetch has settled, success or failure. False also while a refetch is in flight. */
  loaded: boolean;
  /** True only if the fetch settled by failing. */
  error: boolean;
}

export interface UseDemoProductsResult extends DemoProductsData {
  /**
   * Read the catalog again. Quiet keeps what is on screen, and `loaded`, until
   * the new answer replaces it, and keeps it if the read fails: for a catalog
   * that has only gained pictures (the library download landing), where
   * falling back to skeletons would be the flash this exists to avoid.
   */
  refetch: (opts?: { quiet?: boolean }) => Promise<void>;
}

const EMPTY: DemoProductsData = { demoProducts: [], categories: [], loaded: false, error: false };

/**
 * The demo-product catalog, asked for once for the whole app — same shape as
 * `useScenes`/`usePresenters`, for the same reason: several surfaces want it
 * (the showcase gallery, a showcase-seeded Composer's chip rendering) and it
 * does not change while the server runs.
 */
export function useDemoProducts(): UseDemoProductsResult {
  const [data, setData] = useState<DemoProductsData>(EMPTY);
  const [tick, setTick] = useState(0);
  const quiet = useRef(false);
  // whoever asked for a re-read, told when a read settles (AppShell waits on it)
  const settled = useRef<(() => void)[]>([]);

  useEffect(() => {
    let alive = true;
    void api
      .demoProducts()
      .then((r) => {
        if (alive)
          setData((d) =>
            keepIfSame(d, { demoProducts: r.demoProducts, categories: r.categories, loaded: true, error: false }),
          );
      })
      .catch(() => {
        if (alive && !quiet.current) setData((d) => ({ ...d, loaded: true, error: true }));
      })
      .finally(() => {
        if (alive) release(settled);
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  const refetch = useCallback(
    (opts?: { quiet?: boolean }) =>
      new Promise<void>((resolve) => {
        settled.current.push(resolve);
        quiet.current = !!opts?.quiet;
        if (!quiet.current) setData((d) => ({ ...d, loaded: false, error: false }));
        setTick((t) => t + 1);
      }),
    [],
  );

  return { ...data, refetch };
}
