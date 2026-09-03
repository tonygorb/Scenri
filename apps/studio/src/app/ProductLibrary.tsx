import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type Brand, type Product } from '../api.js';
import { useTaskCenter } from './TaskCenter.js';

export interface ProductLibraryValue {
  products: Product[];
  /**
   * Whether the first answer for this brand has landed.
   *
   * Not cosmetic: "this brand owns no products" is what decides whether a page
   * leads with its cold offer, and an empty array on the way to the network is
   * indistinguishable from a real zero without this.
   */
  productsLoaded: boolean;
  /** Re-read the library now: for a surface that has just written to it. */
  refreshProducts: () => Promise<void>;
}

const Ctx = createContext<ProductLibraryValue | null>(null);

export function useProductLibrary(): ProductLibraryValue | null {
  return useContext(Ctx);
}

/**
 * The unified product library (manual + catalog import) for the brand on
 * screen, read once and re-read on the events that change it.
 *
 * This used to be a 4 s poll. Every tick replaced the array with a fresh one,
 * BrandLayout re-rendered, and every one of its consumers, the whole route
 * subtree included, re-rendered with it, whether or not a single product had
 * changed. Nothing about the library moves on its own: it changes when the
 * brand document changes (a manual product added, renamed, deleted), when a
 * catalog import job makes progress, or when a product page writes to it. So
 * those are the three reads, and an identical answer never reaches React.
 */
export function ProductLibraryProvider({ brand, children }: { brand: Brand; children: ReactNode }) {
  const brandId = brand.id;
  const [state, setState] = useState<{ products: Product[]; loaded: boolean }>({ products: [], loaded: false });
  const lastRef = useRef<string | null>(null);
  const { tasks } = useTaskCenter();
  /** Where every import job stands, as one string: a change means the library moved. */
  const catalogSignature = tasks
    .filter((t) => t.kind === 'catalog')
    .map((t) => `${t.id}:${t.state}:${t.percent ?? ''}:${t.subtitle ?? ''}`)
    .join('|');

  const load = useCallback(async () => {
    try {
      const r = await api.productsLibrary(brandId);
      const text = JSON.stringify(r.products);
      setState((cur) => {
        if (cur.loaded && lastRef.current === text) return cur;
        lastRef.current = text;
        return { products: r.products, loaded: true };
      });
    } catch {
      // A failed read is not "this brand has nothing": keep what is on screen
      // and let the next event correct it.
      setState((cur) => ({ products: cur.products, loaded: true }));
    }
  }, [brandId]);

  // the other brand's answer is not an answer about this one
  useEffect(() => {
    lastRef.current = null;
    setState({ products: [], loaded: false });
  }, [brandId]);

  useEffect(() => {
    let alive = true;
    void load().then(() => {
      if (!alive) return;
    });
    return () => {
      alive = false;
    };
  }, [load, brand.updatedAt, catalogSignature]);

  const value = useMemo<ProductLibraryValue>(
    () => ({ products: state.products, productsLoaded: state.loaded, refreshProducts: load }),
    [state.products, state.loaded, load],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
