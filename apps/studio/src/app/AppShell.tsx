import { createContext, useCallback, useContext, useEffect, useRef, useState, useMemo } from 'react';
import { Outlet, ScrollRestoration, useSearchParams } from 'react-router';
import { Flex, Spinner } from '@radix-ui/themes';
import {
  api,
  type Brand,
  type ContentState,
  type EngineInfo,
  type Presenter,
  type DemoProduct,
  type ShowcaseEntry,
} from '../api.js';
import { loadGuide } from '../guide.js';
import { DocumentTitleCtx, useDocumentTitle } from '../useDocumentTitle.js';
import { useScenes, type UseScenesResult } from '../useScenes.js';
import { usePresenters } from '../usePresenters.js';
import { useDemoProducts } from '../useDemoProducts.js';
import { useShowcase } from '../useShowcase.js';
import { FailureRow } from '../layout/Failure.js';
import { UpdateCenterProvider } from './UpdateCenter.js';
import { applyBrandRow, mergeBrandList } from './brandRows.js';
import { WhatsNewProvider } from './WhatsNew.js';

/** The least time between two re-reads of the brands on coming back to the tab. */
const BACK_MS = 5000;

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
  /** Re-read brands and engines: a key or engine change, or a brand created or deleted. */
  refresh: () => Promise<void>;
  /**
   * Re-read the brands alone, for a write the client did not answer itself: a
   * build that landed on the server, a delete that found the record already
   * gone. Leaves the engines alone, whose probe can take seconds.
   */
  refreshBrands: () => Promise<void>;
  /**
   * Put one brand row, as a mutation just answered it, in front of every
   * surface. This is the whole propagation for anything that lives in the
   * brand document (owned presenters and scenes, manual products, logos,
   * palette): the wall, the page, the pickers and the chips all read this row.
   *
   * An answer older than the row held is refused, and a list re-read that was
   * already out when this landed cannot undo it (see brandRows.ts).
   */
  applyBrand: (next: Brand) => void;
  /**
   * Library pictures are still on their way to this machine (a first run's
   * one-time download). A catalog card with no picture yet shows its place
   * held rather than the empty glyph while this is true.
   */
  contentArriving: boolean;
  /**
   * What the activity poll last said about the download. When it has
   * installed, the four catalogs are read again, quietly, so the pictures
   * appear on the cards already on screen without a reload.
   */
  noteContent: (content: ContentState | undefined) => void;
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

  const [content, setContent] = useState<ContentState | null>(null);
  const noteContent = useCallback((next: ContentState | undefined) => {
    if (!next) return;
    setContent((cur) => (cur && cur.arriving === next.arriving && cur.installs === next.installs ? cur : next));
  }, []);
  // The catalogs were read once, at startup, and the library download lands
  // later: without this its pictures stayed missing until a reload. The first
  // answer that shows an install made by this server reads them again (the
  // install may have landed while the person was still in setup), and so does
  // every install after it. Quietly: the cards stay, and gain their pictures.
  const handledInstalls = useRef<number | null>(null);
  const { refetch: refetchScenes } = scenes;
  const { refetch: refetchPresenters } = presenters;
  const { refetch: refetchDemoProducts } = demoProducts;
  const { refetch: refetchShowcase } = showcase;
  useEffect(() => {
    if (!content) return;
    const was = handledInstalls.current;
    handledInstalls.current = content.installs;
    if (content.installs === 0 || was === content.installs) return;
    for (const refetch of [refetchScenes, refetchPresenters, refetchDemoProducts, refetchShowcase])
      refetch({ quiet: true });
  }, [content, refetchScenes, refetchPresenters, refetchDemoProducts, refetchShowcase]);

  /**
   * One counter orders every write to the list: a mutation answer applied, a
   * list read started. Whatever was applied after a read started is newer than
   * anything that read can carry.
   */
  const clock = useRef(0);
  const appliedAt = useRef(new Map<string, number>());
  const latestRead = useRef(0);
  const loadedOnce = useRef(false);

  const applyBrand = useCallback((next: Brand) => {
    appliedAt.current.set(next.id, ++clock.current);
    setBrands((cur) => (cur ? applyBrandRow(cur, next) : cur));
  }, []);

  const readBrands = useCallback(async () => {
    const started = ++clock.current;
    latestRead.current = started;
    const answer = await api.brands();
    // a newer read is already out, and it answers instead of this one
    if (latestRead.current !== started) return;
    const touched = new Set<string>();
    for (const [id, at] of appliedAt.current) if (at > started) touched.add(id);
    setBrands((cur) => mergeBrandList(cur, answer, touched));
  }, []);

  // Callers in the background (the bell's poll above all) await this, and a
  // rejection there would end the poll loop for good. A failed read changes
  // nothing on screen; the next one corrects it.
  const refreshBrands = useCallback(() => readBrands().catch(() => undefined), [readBrands]);

  const refresh = useCallback(async () => {
    try {
      // Brands land when brands answer. They used to wait for the engines too,
      // whose Codex probe can take seconds, and every mutation answer applied
      // in that window was then overwritten by the older list.
      await Promise.all([readBrands(), api.engines().then(setEngines)]);
      loadedOnce.current = true;
    } catch (err: any) {
      // A background re-read that fails is not a reason to replace the whole
      // studio with an error: what is on screen is still the last truth, and
      // the next write or read corrects it. Only a first load that never
      // arrived has nothing to show.
      if (!loadedOnce.current) setError(String(err.message ?? err));
    }
  }, [readBrands]);

  useEffect(() => {
    void refresh();
    // on its own, never in refresh's Promise.all: see guide.ts
    void loadGuide();
  }, [refresh]);

  /**
   * Another tab can change the library under this one: a presenter deleted
   * there stayed a card, a picker entry and a sendable chip here for as long
   * as this tab stayed open. Coming back to the tab re-reads the brands. Focus
   * and visibility both fire on the way back, so one read covers a few seconds.
   */
  useEffect(() => {
    let last = 0;
    const back = () => {
      if (document.hidden || Date.now() - last < BACK_MS) return;
      last = Date.now();
      void refreshBrands();
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
    };
  }, [refreshBrands]);

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
            refreshBrands,
            applyBrand,
            contentArriving: !!content?.arriving,
            noteContent,
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
      refreshBrands,
      applyBrand,
      content?.arriving,
      noteContent,
    ],
  );

  if (error) {
    return (
      <Flex align="center" justify="center" height="100vh" p="5">
        <FailureRow
          failure={{
            kind: 'unknown',
            title: 'Scenri could not read your library.',
            fix: 'Check that it is still running, then reload.',
            raw: error,
            retryable: true,
          }}
        />
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
