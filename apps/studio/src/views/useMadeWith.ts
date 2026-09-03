import { useEffect, useState } from 'react';
import { api, type FeedNode } from '../api.js';

/**
 * The newest shots whose brief carried one of these ids: what a product,
 * presenter or scene page shows under "made with this". One indexed query,
 * newest first, capped at what the row displays; it used to be a scan of
 * every shot in the brand and every token in every brief, per render.
 */
export function useMadeWith(brandId: string, tokenIds: readonly string[], limit = 12): FeedNode[] {
  const key = tokenIds.filter(Boolean).join(',');
  const [held, setHeld] = useState<{ key: string; items: FeedNode[] }>({ key: '', items: [] });
  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    api
      .feed(brandId, { token: key, limit }, ctrl.signal)
      .then((page) => {
        if (!ctrl.signal.aborted)
          setHeld({ key, items: page.items.filter((n) => n.status === 'done' && n.images.length > 0) });
      })
      .catch(() => {
        /* the row stays empty; nothing else on the page depends on it */
      });
    return () => ctrl.abort();
  }, [brandId, key, limit]);
  return held.key === key ? held.items : [];
}
