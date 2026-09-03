import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useMatch, useParams } from 'react-router';
import { api, type ActivityNode, type Brand, type FeedNode, type Project, type ShotSet } from '../api.js';
import { P, brandPath } from '../routes.js';
import { PREF, rememberBrand, useLocalPref } from '../prefs.js';
import { TabBar } from '../layout/TabBar.js';
import { TopBar } from '../layout/TopBar.js';
import { AssetCreateHost } from '../create/AssetCreateHost.js';
import { useKeyboardInset } from '../useKeyboardInset.js';
import { ProductLibraryProvider, useProductLibrary, type ProductLibraryValue } from './ProductLibrary.js';
import { SettingsDialog } from '../views/SettingsDialog.js';
import { WhatsNewDialog } from '../views/WhatsNewDialog.js';
import { ProviderSetup } from '../views/ProviderSetup.js';
import { useAppData } from './AppShell.js';
import { pickBrand } from './RootRedirect.js';
import { TaskCenterProvider } from './TaskCenter.js';
import { mergeRecent } from './recentRules.js';
import { WhatsNewGate } from './WhatsNew.js';

export type ActivityListener = (nodes: FeedNode[]) => void;

interface BrandCore {
  brand: Brand;
  /**
   * The brand's one hidden project. Every node hangs from it; nothing in the UI
   * names it. Null only for the moment before the first answer lands.
   */
  workspace: Project | null;
  /** The project's root, which every new shot hangs off. Null until the first answer lands. */
  root: string | null;
  /** The newest done shots, newest first, for the rail and the attach panel. */
  recent: FeedNode[];
  sets: ShotSet[];
  /** Which shots are in which set, keyed by set id. */
  membership: Record<string, string[]>;
  /**
   * The unified product library (manual + catalog import), polled here once
   * for the whole brand — five surfaces (Home, AssetsPanel, Composer,
   * AttachPanel, BriefInput) each ran their own independent 4s poll of the
   * same endpoint before this moved up.
   */
  /** False until the first answer lands, so /s/:slug knows it cannot resolve yet. */
  loaded: boolean;
  /** Re-read the frame: sets, memberships, the recent shelf. Never the shots, which are paged. */
  refresh: () => Promise<void>;
  /**
   * Put a renamed set back into the list without waiting for a round trip.
   *
   * Renaming moves the slug, and the slug is the address. Refetching first left
   * one render where the list knew only the old name and the URL still asked
   * for it, so /s/:slug decided the set was deleted and bounced to the feed.
   * Patching in place lets the new name and the new URL arrive together.
   */
  applySet: (next: ShotSet) => void;
  dropSet: (id: string) => void;
  insertSet: (set: ShotSet) => void;
  /** A set's whole membership, as the server just answered it. */
  applyMembership: (setId: string, ids: string[]) => void;
  /**
   * Records that changed anywhere (a keep, an archive, a landing). The recent
   * shelf folds them in and every subscriber hears of them; nothing is
   * re-read.
   */
  applyNodes: (nodes: FeedNode[]) => void;
  /** The bell's poll and every applied change, as a stream, for whoever holds shots on screen. */
  subscribeActivity: (fn: ActivityListener) => () => void;
}

export type BrandData = BrandCore & ProductLibraryValue;

const Ctx = createContext<BrandCore | null>(null);

/** What `useBrand()` answers about products before the library provider has mounted (the settings dialogs sit above it). */
const NO_PRODUCTS: ProductLibraryValue = { products: [], productsLoaded: false, refreshProducts: async () => {} };

/**
 * The brand on screen, plus its product library.
 *
 * Two contexts behind one hook: the library lives below TaskCenter (it reads
 * the import jobs the bell already polls, and re-reads on them), the rest of
 * the brand lives above it. Every consumer destructures, so the merged object
 * only has to be stable while neither half changed.
 */
export function useBrand(): BrandData {
  const core = useContext(Ctx);
  const library = useProductLibrary() ?? NO_PRODUCTS;
  if (!core) throw new Error('useBrand must be used inside BrandLayout');
  return useMemo(() => ({ ...core, ...library }), [core, library]);
}

interface AssetsPanelState {
  open: boolean;
  toggle: () => void;
  setOpen: (v: boolean) => void;
}

const AssetsCtx = createContext<AssetsPanelState | null>(null);

/**
 * The panel is a preference, not a location, but the button that opens it lives
 * in the bar and the panel itself lives in the project screen. One owner above
 * both: useLocalPref is plain useState behind localStorage, so two callers would
 * quietly hold two different answers.
 */
export function useAssetsPanel(): AssetsPanelState {
  const value = useContext(AssetsCtx);
  if (!value) throw new Error('useAssetsPanel must be used inside BrandLayout');
  return value;
}

/**
 * Everything under /:brandSlug. The brand lives in the path rather than in
 * state, so a refresh cannot quietly hand you a different client's work.
 *
 * The segment is the slug, but an id still resolves: bookmarks and links made
 * before slugs, and anything a rename left behind, keep working.
 */
export function BrandLayout() {
  const { brandSlug } = useParams();
  const { pathname, search } = useLocation();
  // where this brand's own segment ends, so a rewrite can keep the rest of the
  // path without counting segments and without re-encoding what it passes on
  const here = useMatch({ path: P.brand, end: false });
  const { brands, engines, refresh } = useAppData();
  const [workspace, setWorkspace] = useState<Project | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [recent, setRecent] = useState<FeedNode[]>([]);
  const [sets, setSets] = useState<ShotSet[]>([]);
  const [membership, setMembership] = useState<Record<string, string[]>>({});
  const [loaded, setLoaded] = useState(false);
  // narrow screens get the panel as a drawer over the canvas: opening one by
  // default is a first run that starts behind a scrim
  const [assetsOpen, setAssetsOpen] = useLocalPref(PREF.assetsOpen, window.innerWidth >= 1280);
  // the '.' shortcut reads this through a listener that never re-binds, so the
  // toggle has to be an updater rather than a closure over the current value
  const toggleAssets = useCallback(() => setAssetsOpen((v) => !v), []);
  const assets = useMemo(
    () => ({ open: assetsOpen, toggle: toggleAssets, setOpen: setAssetsOpen }),
    [assetsOpen, toggleAssets],
  );

  // the docks are fixed, so the keyboard has to be measured for them
  useKeyboardInset();

  const brand = brands.find((b) => b.slug === brandSlug) ?? brands.find((b) => b.id === brandSlug) ?? null;

  /**
   * One ask for the whole brand: its shots, its sets, and who is in what.
   * Drawing the feed used to cost one request per project, so a studio with
   * forty of them paid forty round trips to see one screen.
   */
  // the brand on screen right now, for an answer that arrives after a switch
  const brandIdRef = useRef(brand?.id);
  brandIdRef.current = brand?.id;
  const refreshWorkspace = useCallback(async () => {
    if (!brand) return;
    const forBrand = brand.id;
    const ws = await api.workspace(forBrand);
    // a slow answer for the brand you left is not an answer about this one
    if (brandIdRef.current !== forBrand) return;
    setWorkspace(ws.project);
    setRoot(ws.root);
    setRecent(ws.recent);
    setSets(ws.sets);
    setMembership(ws.membership);
    setLoaded(true);
  }, [brand?.id]);

  /**
   * Every change to a record, wherever it came from, on one stream.
   *
   * The bell's poll used to be folded into a list of every shot held here; a
   * record naming a shot the list had never seen re-read the whole brand. The
   * feed owns its own pages now and subscribes; the frame only keeps the
   * recent shelf current.
   */
  const listeners = useRef(new Set<ActivityListener>());
  const subscribeActivity = useCallback((fn: ActivityListener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);
  const applyNodes = useCallback((nodes: FeedNode[]) => {
    if (!nodes.length) return;
    setRecent((prev) => mergeRecent(prev, nodes));
    for (const fn of listeners.current) fn(nodes);
  }, []);
  const applyActivity = useCallback(
    (forBrand: string, fresh: ActivityNode[]) => {
      // the other brand's answer is not an answer about this one
      if (!brand || forBrand !== brand.id) return;
      applyNodes(fresh);
    },
    [brand?.id, applyNodes],
  );

  const applySet = useCallback((next: ShotSet) => setSets((cur) => cur.map((s) => (s.id === next.id ? next : s))), []);
  const dropSet = useCallback((id: string) => setSets((cur) => cur.filter((s) => s.id !== id)), []);
  const insertSet = useCallback(
    (set: ShotSet) => setSets((cur) => (cur.some((s) => s.id === set.id) ? cur : [set, ...cur])),
    [],
  );
  const applyMembership = useCallback(
    (setId: string, ids: string[]) => setMembership((cur) => ({ ...cur, [setId]: ids })),
    [],
  );

  /**
   * One object for as long as nothing in it changed. An inline literal here
   * was a new object on every BrandLayout render, and BrandLayout rendered on
   * every product poll, so all thirty consumers of useBrand() and the whole
   * route subtree re-rendered every four seconds for nothing.
   */
  const value = useMemo<BrandCore | null>(
    () =>
      brand
        ? {
            brand,
            workspace,
            root,
            recent,
            sets,
            membership,
            loaded,
            refresh: refreshWorkspace,
            applySet,
            dropSet,
            insertSet,
            applyMembership,
            applyNodes,
            subscribeActivity,
          }
        : null,
    [
      brand,
      workspace,
      root,
      recent,
      sets,
      membership,
      loaded,
      refreshWorkspace,
      applySet,
      dropSet,
      insertSet,
      applyMembership,
      applyNodes,
      subscribeActivity,
    ],
  );

  // the other brand's answer is not an answer about this one
  useEffect(() => {
    setLoaded(false);
    setRecent([]);
    setRoot(null);
  }, [brand?.id]);

  useEffect(() => {
    if (brand) rememberBrand(brand.id);
  }, [brand?.id]);

  // Keyed on the brand alone. This used to re-run on `brand.updatedAt` too,
  // so every brand-kit autosave, palette edit and presenter rename re-read
  // every shot in the brand; a brand write never changes what shots exist.
  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  // the settings dialogs can change what the frame holds (the danger pane
  // removes every shot), so what they save re-reads both the app and the frame
  const refreshAll = useCallback(() => {
    void refresh();
    void refreshWorkspace();
  }, [refresh, refreshWorkspace]);

  // The tail comes off the raw pathname rather than out of a param, so whatever
  // follows — /scenes/<id>, /sets/<slug>/shots/<id> — survives a swap of the
  // brand segment exactly as it arrived, and no part of this has to know how
  // deep the path goes.
  const tail = here ? pathname.slice(here.pathnameBase.length) : '';

  // a deleted brand, or a link to one this machine has never seen. The page
  // asked for is still a real page, so it comes along: landing on /scenes of a
  // brand you do have beats being dropped at a home you did not ask for.
  if (!brand) {
    const fallback = pickBrand(brands);
    return <Navigate to={fallback ? brandPath(fallback) + tail + search : P.root} replace />;
  }

  // reached by id: rewrite to the slug so the address bar stays readable and
  // everything downstream can assume one spelling of the path
  if (brandSlug !== brand.slug) return <Navigate to={brandPath(brand) + tail + search} replace />;

  return (
    <Ctx.Provider value={value!}>
      <SettingsDialog engines={engines} brandId={brand.id} onSaved={refreshAll} />
      <ProviderSetup engines={engines} onSaved={refresh} />
      <WhatsNewDialog />
      <TaskCenterProvider brand={brand} onActivity={applyActivity}>
        {/* Inside TaskCenter: the library re-reads on the import jobs the bell
            polls, and everything below reads it through useBrand(). */}
        <ProductLibraryProvider brand={brand}>
          {/* The gate needs what only this level knows: whether anything is
              generating or building. It renders nothing. */}
          <WhatsNewGate />
          {/* Inside TaskCenter: a creation flow reads the builds already in
              flight, and pokes the one poll when it starts another. */}
          <AssetCreateHost>
            <AssetsCtx.Provider value={assets}>
              <div className="sc-shell">
                <TopBar />
                <Outlet />
                <TabBar />
              </div>
            </AssetsCtx.Provider>
          </AssetCreateHost>
        </ProductLibraryProvider>
      </TaskCenterProvider>
    </Ctx.Provider>
  );
}
