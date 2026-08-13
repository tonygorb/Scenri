import { useEffect, useRef } from 'react';
import {
  Navigate,
  createBrowserRouter,
  useLocation,
  useMatch,
  useNavigate,
  useParams,
  useRouteError,
} from 'react-router';
import { Callout, Flex } from '@radix-ui/themes';
import { AppShell } from './app/AppShell.js';
import { BrandLayout, useBrand } from './app/BrandLayout.js';
import { P, hubPath, rewriteLegacyPath, setPath } from './routes.js';
import { RootRedirect } from './app/RootRedirect.js';
import { BrandSetup } from './views/BrandSetup.js';
import { HomeView } from './views/Home.js';
import { ScenesView } from './views/Scenes.js';
import { ScenePage } from './views/ScenePage.js';
import { PresentersView } from './views/Presenters.js';
import { PresenterPage } from './views/PresenterPage.js';
import { ProductsView } from './views/Products.js';
import { ProductPage } from './views/ProductPage.js';
import { CreateView } from './views/Create.js';
import { ShotDetailRoute } from './views/ShotDetailRoute.js';

function RouteError() {
  const error = useRouteError() as any;
  return (
    <Flex align="center" justify="center" height="100vh">
      <Callout.Root color="red">
        <Callout.Text>{String(error?.message ?? error)}</Callout.Text>
      </Callout.Root>
    </Flex>
  );
}

/**
 * Turns the path segment into a set. It is the slug, but an id still resolves
 * and rewrites itself, so older links and anything holding an id keep landing
 * in the right place.
 *
 * React Router keeps a component mounted when only a param changes, and the
 * workspace carries per-view drafts (text layers, a pending remix, a selection)
 * that must not follow you into the next set. Keying on the id restores the
 * clean slate a route swap used to give for free.
 */
function SetRoute() {
  const { setSlug = '' } = useParams();
  const { pathname, search } = useLocation();
  const { brand, sets, loaded } = useBrand();
  const navigate = useNavigate();
  const here = useMatch({ path: P.set, end: false });
  const set = sets.find((s) => s.slug === setSlug) ?? sets.find((s) => s.id === setSlug) ?? null;

  /**
   * A rename moves two things that live in different stores: the slug in the
   * address bar and the name in the set list. There is no order in which they
   * can be written that avoids one render where they disagree — the list is
   * React state, the URL is the router's own — so for one render the URL names
   * a set the list has already renamed.
   *
   * Redirecting on the spot read that disagreement as "this set was deleted"
   * and threw you out of the set you had just named. So the miss is only
   * believed a tick later, and only if it is *still* true then: the check reads
   * through a ref rather than closing over the render that scheduled it, which
   * is what made the first attempt at this fire on a stale snapshot anyway.
   */
  const latest = useRef({ setSlug, sets });
  latest.current = { setSlug, sets };
  useEffect(() => {
    if (!loaded || set) return;
    const t = setTimeout(() => {
      const { setSlug: id, sets: list } = latest.current;
      if (list.some((s) => s.slug === id || s.id === id)) return;
      navigate(hubPath(brand), { replace: true });
    }, 0);
    return () => clearTimeout(t);
  }, [loaded, set, brand, navigate]);

  // nothing to resolve against until the brand's sets land, and nothing to draw
  // while the miss above is still being given its tick
  if (!loaded || !set) return null;
  if (set.slug !== setSlug) {
    // keep whatever follows, so an open shot survives the rewrite
    const tail = here ? pathname.slice(here.pathnameBase.length) : '';
    return <Navigate to={setPath(brand, set) + tail + search} replace />;
  }
  return <CreateView key={set.id} set={set} />;
}

/**
 * Every URL the old scheme could spell, sent to the one that replaced it.
 *
 * Three redirects used to live here — one for projects once they became sets,
 * one for a shot that predates the overlay moving under the hub, and now the
 * `/b/` prefix itself. They are one rewrite rather than three components
 * because they are one question, and because a pure function is testable in a
 * way a tree of <Navigate> elements is not.
 */
function LegacyRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={rewriteLegacyPath(pathname, search)} replace />;
}

/** /:brandSlug/kit → the brand's home with the Brand kit pane open. */
function KitRedirect() {
  const { brandSlug } = useParams();
  return <Navigate to={`/${brandSlug}?settings=brand`} replace />;
}

function SceneRoute() {
  const { sceneId } = useParams();
  return <ScenePage key={sceneId} />;
}

function PresenterRoute() {
  const { presenterId } = useParams();
  return <PresenterPage key={presenterId} />;
}

function ProductRoute() {
  const { productId } = useParams();
  return <ProductPage key={productId} />;
}

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <RootRedirect /> },
      { path: P.setup, element: <BrandSetup /> },
      // the scheme this replaced, kept alive for the links that outlived it
      { path: P.legacy, element: <LegacyRedirect /> },
      {
        path: P.brand,
        element: <BrandLayout />,
        children: [
          // Home is the way in and carries no tools. Create is the hub, and the
          // only screen with the assets rail, the lenses and the brief.
          { index: true, element: <HomeView /> },
          // the shot overlay is a child route, so opening one keeps the hub
          // mounted underneath and does not refetch it
          {
            path: P.hub,
            element: <CreateView set={null} />,
            children: [{ path: P.hubShot, element: <ShotDetailRoute /> }],
          },
          {
            path: P.set,
            element: <SetRoute />,
            children: [{ path: P.setShot, element: <ShotDetailRoute /> }],
          },
          // The brand kit is Settings now: it is per-brand configuration filled
          // in once, not a destination. The route stays so the links that point
          // at it — the catalog-import notification, the legacy /b/<brand>/brand
          // rewrite, anyone's bookmark — land in the pane instead of nowhere.
          { path: P.kit, element: <KitRedirect /> },
          { path: P.products, element: <ProductsView /> },
          { path: P.product, element: <ProductRoute /> },
          { path: P.scenes, element: <ScenesView /> },
          { path: P.scene, element: <SceneRoute /> },
          { path: P.presenters, element: <PresentersView /> },
          { path: P.presenter, element: <PresenterRoute /> },
        ],
      },
      { path: P.notFound, element: <Navigate to={P.root} replace /> },
    ],
  },
]);
