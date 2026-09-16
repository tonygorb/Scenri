import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type Brand, type Product } from '../api.js';
import { useTaskCenter } from './TaskCenter.js';

export interface ProductLibraryValue {
  products: Product[];
  /**
   * Whether a catalogue import is filling this library right now.
   *
   * The wall reads it so a run appears as products arriving rather than as a
   * grid of empty frames: a product is written the moment its page is read and
   * its pictures follow, so 294 of them landed at once and then sat blank for
   * as long as the downloads took.
   */
  importing: boolean;
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
  /**
   * Which catalog work exists, not how far along it is.
   *
   * This carried `percent` and `subtitle`, and the subtitle holds live counters
   * ("read 812 of 2,199"). The task centre polls every 1.5 seconds while
   * anything runs, so the signature changed on every tick and every tick
   * refetched the entire library, stringified all of it on the main thread and
   * handed React a new array - which re-rendered every mounted card. That is
   * what made the app feel frozen during an import.
   *
   * Arrivals are picked up by the poll below instead, which asks only for what
   * is new.
   */
  const catalogSignature = tasks
    .filter((t) => t.kind === 'catalog')
    .map((t) => `${t.id}:${t.state}`)
    .join('|');
  const importing = tasks.some((t) => t.kind === 'catalog' && t.state === 'running');

  const load = useCallback(async () => {
    try {
      const r = await api.productsLibrary(brandId);
      const text = JSON.stringify(r.products);
      // Compared and recorded HERE, never inside the updater below.
      //
      // This guard used to live in a `setState(cur => ...)` updater that wrote
      // `lastRef.current` as a side effect. React calls an updater twice in
      // StrictMode and keeps the second answer: the first call recorded the new
      // signature and returned the new list, the second saw its own write, took
      // the early return and handed back the OLD state. Every poll during an
      // import threw its own result away, so products only ever appeared on a
      // reload. An updater has to be pure; the bookkeeping belongs out here.
      //
      // `null` is "nothing accepted yet", so the first answer always lands,
      // including an honest empty one.
      if (lastRef.current === text) return;
      lastRef.current = text;
      setState({ products: r.products, loaded: true });
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

  /**
   * While an import runs, products keep arriving. Re-read the light index on a
   * calm cadence so they turn up without the user refreshing, and let the
   * identity check below drop the ticks where nothing changed.
   *
   * Two seconds, not the task centre's 1.5: this is a list of 177-byte entries
   * and nobody is waiting on the difference.
   */
  useEffect(() => {
    if (!importing) return;
    const id = setInterval(() => void load(), 2000);
    return () => clearInterval(id);
  }, [importing, load]);

  const value = useMemo<ProductLibraryValue>(
    () => ({ products: state.products, productsLoaded: state.loaded, importing, refreshProducts: load }),
    [state.products, state.loaded, importing, load],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
