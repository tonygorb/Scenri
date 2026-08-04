import { useEffect, useState } from 'react';
import { api, type Look } from './api.js';

export interface LooksData {
  looks: Look[];
  collections: string[];
  verticals: string[];
}

const EMPTY: LooksData = { looks: [], collections: [], verticals: [] };

/**
 * The look catalog, asked for once for the whole app. Eight surfaces want it
 * and it does not change while the server runs, so one ask in the shell beats
 * eight that refire on every navigation.
 */
export function useLooks(): LooksData {
  const [data, setData] = useState<LooksData>(EMPTY);

  useEffect(() => {
    let alive = true;
    void api
      .looks()
      .then((r) => {
        if (alive) setData({ looks: r.looks, collections: r.collections, verticals: r.verticals });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return data;
}
