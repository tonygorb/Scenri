import { createContext, useCallback, useContext, useEffect, useState, useMemo } from 'react';
import { Outlet, ScrollRestoration, useSearchParams } from 'react-router';
import { Flex, Spinner } from '@radix-ui/themes';
import { api, type Brand, type EngineInfo, type Presenter, type DemoProduct, type ShowcaseEntry } from '../api.js';
import { DocumentTitleCtx, useDocumentTitle } from '../useDocumentTitle.js';
import { useScenes, type UseScenesResult } from '../useScenes.js';
import { usePresenters } from '../usePresenters.js';
import { useDemoProducts } from '../useDemoProducts.js';
import { useShowcase } from '../useShowcase.js';
import { FailureRow } from '../layout/Failure.js';
import { describeFailure } from '../failure.js';
import { UpdateCenterProvider } from './UpdateCenter.js';
import { WhatsNewProvider } from './WhatsNew.js';

// usePresenters and useScenes both expose `loaded`/`error`/`refetch` — spreading
// both into one context would let whichever lands second silently win for
// existing Scenes consumers. Namespaced instead, so both stay independently
// readable. demoProducts and showcase follow the same namespaced convention.
interface AppData extends UseScenesResult {
  brands: Brand[];
  engines: EngineInfo[];
  presenters: Presenter[];
  presenterCategories: string[];
  presenterStyles: string[];
  presentersLoaded: boolean;
  presentersError: boolean;
  refetchPresenters: () => void;
  demoProducts: DemoProduct[];
  demoProductCategories: string[];
  demoProductsLoaded: boolean;
  demoProductsError: boolean;
  showcase: ShowcaseEntry[];
  showcaseCategories: string[];
  showcaseLoaded: boolean;
  showcaseError: boolean;
  refetchShowcase: () => void;
  /** Re-read brands and engines: brand edits and key changes both land here. */
  refresh: () => Promise<void>;
  /**
   * Swap one already-known brand row in place.
   *
   * `refresh()` would do it too, but it bumps `updatedAt` on the brand every
   * consumer watches, and BrandLayout reacts to that by refetching the whole
   * workspace — once per pause in an autosaving form. This is the narrow write
   * for a page that already holds the row the server just returned.
   */
  applyBrand: (next: Brand) => void;
}

const Ctx = createContext<AppData | null>(null);

export function useAppData(): AppData {
  const value = useContext(Ctx);
  if (!value) throw new Error('useAppData must be used inside AppShell');
  return value;
}

/**
 * The one thing mounted under every URL. It owns what the whole app needs to
 * exist at all: brands, engines and the scene catalog. The dialogs sit a level
 * down in BrandLayout, since both of them are about a brand's projects.
 */
export function AppShell() {
  const publishTitle = useDocumentTitle();
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scenes = useScenes();
  const presenters = usePresenters();
  const demoProducts = useDemoProducts();
  const showcase = useShowcase();

  const applyBrand = useCallback((next: Brand) => {
    setBrands((cur) => (cur ? cur.map((b) => (b.id === next.id ? next : b)) : cur));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [b, e] = await Promise.all([api.brands(), api.engines()]);
      setBrands(b);
      setEngines(e);
    } catch (err: any) {
      setError(String(err.message ?? err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * One value for as long as nothing in it changed. The four catalog hooks
   * each hand back a fresh wrapper object per render, so the deps are their
   * fields, not the wrappers: an AppShell render that changed nothing must
   * not re-render the 24 consumers below it.
   */
  const value = useMemo<AppData | null>(
    () =>
      brands === null
        ? null
        : {
            brands,
            engines,
            scenes: scenes.scenes,
            collections: scenes.collections,
            verticals: scenes.verticals,
            loaded: scenes.loaded,
            error: scenes.error,
            refetch: scenes.refetch,
            presenters: presenters.presenters,
            presenterCategories: presenters.categories,
            presenterStyles: presenters.styles,
            presentersLoaded: presenters.loaded,
            presentersError: presenters.error,
            refetchPresenters: presenters.refetch,
            demoProducts: demoProducts.demoProducts,
            demoProductCategories: demoProducts.categories,
            demoProductsLoaded: demoProducts.loaded,
            demoProductsError: demoProducts.error,
            showcase: showcase.showcase,
            showcaseCategories: showcase.categories,
            showcaseLoaded: showcase.loaded,
            showcaseError: showcase.error,
            refetchShowcase: showcase.refetch,
            refresh,
            applyBrand,
          },
    [
      brands,
      engines,
      scenes.scenes,
      scenes.collections,
      scenes.verticals,
      scenes.loaded,
      scenes.error,
      scenes.refetch,
      presenters.presenters,
      presenters.categories,
      presenters.styles,
      presenters.loaded,
      presenters.error,
      presenters.refetch,
      demoProducts.demoProducts,
      demoProducts.categories,
      demoProducts.loaded,
      demoProducts.error,
      showcase.showcase,
      showcase.categories,
      showcase.loaded,
      showcase.error,
      showcase.refetch,
      refresh,
      applyBrand,
    ],
  );

  if (error) {
    return (
      <Flex align="center" justify="center" height="100vh" p="5">
        <FailureRow failure={describeFailure(error)} />
      </Flex>
    );
  }
  if (brands === null) {
    return (
      <Flex align="center" justify="center" height="100vh">
        <Spinner size="3" />
      </Flex>
    );
  }

  return (
    <Ctx.Provider value={value!}>
      {/* The tab is written in one place, above everything that could name
          it, and the pages below publish through this. */}
      <DocumentTitleCtx.Provider value={publishTitle}>
        {/* Machine-scoped, so it sits above the brand tree: an app update is
            about this install, not about whichever brand is open. */}
        <UpdateCenterProvider>
          {/* Its neighbour, not its child in spirit: one says a newer Scenri
              exists, the other says what this one changed. Both are about the
              install rather than the brand, so both live up here. */}
          <WhatsNewProvider>
            <ScrollRestoration />
            <Outlet />
          </WhatsNewProvider>
        </UpdateCenterProvider>
      </DocumentTitleCtx.Provider>
    </Ctx.Provider>
  );
}

/**
 * Settings and the project picker are detours, not destinations, but they still
 * survive a refresh and answer to Back. Opening pushes an entry so Back closes
 * the dialog; closing replaces, so Back then leaves the screen rather than
 * reopening what you just dismissed.
 */
export function useDialogParam(name: string) {
  const [params, setParams] = useSearchParams();
  const value = params.get(name);

  const open = useCallback(
    (next: string) => {
      setParams(
        (cur) => {
          const p = new URLSearchParams(cur);
          p.set(name, next);
          return p;
        },
        { replace: false },
      );
    },
    [name, setParams],
  );

  /** Moving around inside an open dialog is not a new destination. */
  const set = useCallback(
    (next: string) => {
      setParams(
        (cur) => {
          const p = new URLSearchParams(cur);
          p.set(name, next);
          return p;
        },
        { replace: true },
      );
    },
    [name, setParams],
  );

  const close = useCallback(() => {
    setParams(
      (cur) => {
        const p = new URLSearchParams(cur);
        p.delete(name);
        return p;
      },
      { replace: true },
    );
  }, [name, setParams]);

  return { value, open, set, close };
}

/**
 * A filter is not a destination. It survives a refresh and travels in a pasted
 * link, but it replaces rather than piling up entries, so Back still means the
 * screen before this one. The default drops out of the URL entirely.
 */
export function useFilterParam(name: string, fallback = '') {
  const [params, setParams] = useSearchParams();
  const value = params.get(name) ?? fallback;

  const set = useCallback(
    (next: string | null) => {
      setParams(
        (cur) => {
          const p = new URLSearchParams(cur);
          if (next === null || next === fallback) p.delete(name);
          else p.set(name, next);
          return p;
        },
        { replace: true },
      );
    },
    [name, fallback, setParams],
  );

  return [value, set] as const;
}
