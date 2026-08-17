import { useCallback, useEffect, useState } from 'react';
import { api, type Product } from './api.js';

export interface ProductLibrary {
  products: Product[];
  /**
   * Reload now, rather than on the next tick of the 4s poll.
   *
   * The library is polled, not pushed, so a write made on a product's own page
   * — a rename, a category, a reference reordered — would sit invisible for up
   * to four seconds while the page still showed the old answer. A caller that
   * has just written knows it is stale immediately and can say so.
   */
  reload: () => Promise<void>;
  /**
   * Whether the first answer for this brand has landed.
   *
   * Not cosmetic: "this brand owns no products" is what decides whether a page
   * leads with its cold offer, and an empty array on the way to the network is
   * indistinguishable from a real zero without this. Callers used to read
   * `useBrand().loaded`, which tracks the *workspace* — shots and sets — so a
   * brand with a full catalog flashed the first-run offer on every cold load.
   */
  loaded: boolean;
}

/** Live unified product library (manual + catalog) for a brand. */
export function useProductLibrary(brandId: string | undefined | null): ProductLibrary {
  const [state, setState] = useState<Omit<ProductLibrary, 'reload'>>({ products: [], loaded: false });

  const reload = useCallback(async () => {
    if (!brandId) return;
    try {
      const r = await api.productsLibrary(brandId);
      setState({ products: r.products, loaded: true });
    } catch {
      // A failed poll is not "this brand has nothing" — keep what is already
      // on screen and let the next tick correct it.
      setState((cur) => ({ products: cur.products, loaded: true }));
    }
  }, [brandId]);

  useEffect(() => {
    if (!brandId) {
      setState({ products: [], loaded: true });
      return;
    }
    let alive = true;
    // The other brand's answer is not an answer about this one.
    setState({ products: [], loaded: false });
    const load = () => {
      void api
        .productsLibrary(brandId)
        .then((r) => {
          if (alive) setState({ products: r.products, loaded: true });
        })
        .catch(() => {
          if (alive) setState((cur) => ({ products: cur.products, loaded: true }));
        });
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [brandId]);

  return { ...state, reload };
}
