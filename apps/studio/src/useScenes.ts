import { useCallback, useEffect, useRef, useState } from 'react';
import { api, registerSceneNameAliases, type Scene } from './api.js';

export interface ScenesData {
  scenes: Scene[];
  collections: string[];
  verticals: string[];
  /** True once the fetch has settled, success or failure. False also while a refetch is in flight. */
  loaded: boolean;
  /** True only if the fetch settled by failing. */
  error: boolean;
}

export interface UseScenesResult extends ScenesData {
  /**
   * Read the catalog again. Quiet keeps what is on screen, and `loaded`, until
   * the new answer replaces it, and keeps it if the read fails: for a catalog
   * that has only gained pictures (the library download landing), where
   * falling back to skeletons would be the flash this exists to avoid.
   */
  refetch: (opts?: { quiet?: boolean }) => void;
}

const EMPTY: ScenesData = { scenes: [], collections: [], verticals: [], loaded: false, error: false };

/**
 * The scene catalog, asked for once for the whole app. Eight surfaces want it
 * and it does not change while the server runs, so one ask in the shell beats
 * eight that refire on every navigation.
 */
export function useScenes(): UseScenesResult {
  const [data, setData] = useState<ScenesData>(EMPTY);
  const [tick, setTick] = useState(0);
  const quiet = useRef(false);

  useEffect(() => {
    let alive = true;
    void api
      .scenes()
      .then((r) => {
        // Shot titles for pre-rename nodes read a scene name straight out of
        // their stored prompt; this is the only place the catalog that can
        // translate an old name to the current one is loaded.
        registerSceneNameAliases(r.scenes);
        if (alive)
          setData({
            scenes: r.scenes,
            collections: r.collections,
            verticals: r.verticals,
            loaded: true,
            error: false,
          });
      })
      .catch(() => {
        // a failed fetch is not the same as a still-loading one, and must not
        // silently look like an empty catalog forever
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
