import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation, useMatch, useParams } from 'react-router';
import { api, type Brand, type Product, type Project, type ShotSet, type TreeNode } from '../api.js';
import { P, brandPath } from '../routes.js';
import { PREF, rememberBrand, useLocalPref } from '../prefs.js';
import { TabBar } from '../layout/TabBar.js';
import { TopBar } from '../layout/TopBar.js';
import { AssetCreateHost } from '../create/AssetCreateHost.js';
import { useKeyboardInset } from '../useKeyboardInset.js';
import { useProductLibrary } from '../useProductLibrary.js';
import { SettingsDialog } from '../views/SettingsDialog.js';
import { FeedbackHost } from '../feedback/FeedbackHost.js';
import { ProviderSetup } from '../views/ProviderSetup.js';
import { useAppData } from './AppShell.js';
import { pickBrand } from './RootRedirect.js';
import { TaskCenterProvider } from './TaskCenter.js';

interface BrandData {
  brand: Brand;
  /**
   * The brand's one hidden project. Every node hangs from it; nothing in the UI
   * names it. Null only for the moment before the first answer lands.
   */
  workspace: Project | null;
  /** Every shot in the brand, newest last, roots included. */
  nodes: TreeNode[];
  sets: ShotSet[];
  /** Which shots are in which set, keyed by set id. */
  membership: Record<string, string[]>;
  /**
   * The unified product library (manual + catalog import), polled here once
   * for the whole brand — five surfaces (Home, AssetsPanel, Composer,
   * AttachPanel, BriefInput) each ran their own independent 4s poll of the
   * same endpoint before this moved up.
   */
  products: Product[];
  /** False until the product library's first answer lands for this brand. */
  productsLoaded: boolean;
  /** False until the first answer lands, so /s/:slug knows it cannot resolve yet. */
  loaded: boolean;
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
}

const Ctx = createContext<BrandData | null>(null);

export function useBrand(): BrandData {
  const value = useContext(Ctx);
  if (!value) throw new Error('useBrand must be used inside BrandLayout');
  return value;
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
  const [nodes, setNodes] = useState<TreeNode[]>([]);
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
  const { products, loaded: productsLoaded } = useProductLibrary(brand?.id);

  /**
   * One ask for the whole brand: its shots, its sets, and who is in what.
   * Drawing the feed used to cost one request per project, so a studio with
   * forty of them paid forty round trips to see one screen.
   */
  const refreshWorkspace = useCallback(async () => {
    if (!brand) return;
    const ws = await api.workspace(brand.id);
    setWorkspace(ws.project);
    setNodes(ws.nodes);
    setSets(ws.sets);
    setMembership(ws.membership);
    setLoaded(true);
  }, [brand?.id]);

  const applySet = useCallback((next: ShotSet) => setSets((cur) => cur.map((s) => (s.id === next.id ? next : s))), []);
  const dropSet = useCallback((id: string) => setSets((cur) => cur.filter((s) => s.id !== id)), []);

  // the other brand's answer is not an answer about this one
  useEffect(() => {
    setLoaded(false);
  }, [brand?.id]);

  useEffect(() => {
    if (brand) rememberBrand(brand.id);
  }, [brand?.id]);

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace, brand?.updatedAt]);

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
    <Ctx.Provider
      value={{
        brand,
        workspace,
        nodes,
        sets,
        membership,
        products,
        productsLoaded,
        loaded,
        refresh: refreshWorkspace,
        applySet,
        dropSet,
      }}
    >
      <SettingsDialog engines={engines} shots={nodes} onSaved={refresh} />
      <ProviderSetup engines={engines} onSaved={refresh} />
      <TaskCenterProvider brand={brand}>
        {/* Inside TaskCenter: a creation flow reads the builds already in
            flight, and pokes the one poll when it starts another. */}
        <AssetCreateHost>
          <AssetsCtx.Provider value={assets}>
            <FeedbackHost brand={brand} workspace={workspace} nodes={nodes}>
              <div className="sc-shell">
                <TopBar />
                <Outlet />
                <TabBar />
              </div>
            </FeedbackHost>
          </AssetsCtx.Provider>
        </AssetCreateHost>
      </TaskCenterProvider>
    </Ctx.Provider>
  );
}
