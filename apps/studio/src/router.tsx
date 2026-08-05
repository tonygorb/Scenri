import { useEffect, useRef } from 'react';
import { Navigate, createBrowserRouter, useLocation, useNavigate, useParams, useRouteError } from 'react-router';
import { Callout, Flex } from '@radix-ui/themes';
import { AppShell } from './app/AppShell.js';
import { BrandLayout, useBrand } from './app/BrandLayout.js';
import { brandPath } from './app/brandPath.js';
import { RootRedirect } from './app/RootRedirect.js';
import { BrandSetup } from './views/BrandSetup.js';
import { BrandView } from './views/Brand.js';
import { HomeView } from './views/Home.js';
import { LooksView } from './views/Looks.js';
import { LookPage } from './views/LookPage.js';
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
  const { setId = '' } = useParams();
  const { pathname, search } = useLocation();
  const { brand, sets, loaded } = useBrand();
  const navigate = useNavigate();
  const set = sets.find((s) => s.slug === setId) ?? sets.find((s) => s.id === setId) ?? null;

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
  const latest = useRef({ setId, sets });
  latest.current = { setId, sets };
  useEffect(() => {
    if (!loaded || set) return;
    const t = setTimeout(() => {
      const { setId: id, sets: list } = latest.current;
      if (list.some((s) => s.slug === id || s.id === id)) return;
      navigate(brandPath(brand, '/create'), { replace: true });
    }, 0);
    return () => clearTimeout(t);
  }, [loaded, set, brand, navigate]);

  // nothing to resolve against until the brand's sets land, and nothing to draw
  // while the miss above is still being given its tick
  if (!loaded || !set) return null;
  if (set.slug !== setId) {
    // keep whatever follows, so /n/:nodeId survives the rewrite
    const seg = pathname.split('/');
    seg[4] = set.slug;
    return <Navigate to={seg.join('/') + search} replace />;
  }
  return <CreateView key={set.id} set={set} />;
}

/**
 * Projects are gone: their shots are on the hub and their names became sets. A
 * bookmark, or a notification queued before the upgrade, lands on the hub —
 * which is where a project link was always trying to go.
 */
function LegacyProjectRedirect() {
  const { brand } = useBrand();
  return <Navigate to={brandPath(brand, '/create')} replace />;
}

/** The overlay lives under the hub now, not at the brand root. */
function LegacyShotRedirect() {
  const { brand } = useBrand();
  const { nodeId } = useParams();
  return <Navigate to={brandPath(brand, `/create/n/${nodeId}`)} replace />;
}

function LookRoute() {
  const { lookId } = useParams();
  return <LookPage key={lookId} />;
}

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <RootRedirect /> },
      { path: 'setup', element: <BrandSetup /> },
      {
        path: 'b/:brandId',
        element: <BrandLayout />,
        children: [
          // Home is the way in and carries no tools. Create is the hub, and the
          // only screen with the assets rail, the lenses and the brief.
          { index: true, element: <HomeView /> },
          // the shot overlay is a child route, so opening one keeps the hub
          // mounted underneath and does not refetch it
          {
            path: 'create',
            element: <CreateView set={null} />,
            children: [{ path: 'n/:nodeId', element: <ShotDetailRoute /> }],
          },
          {
            path: 's/:setId',
            element: <SetRoute />,
            children: [{ path: 'n/:nodeId', element: <ShotDetailRoute /> }],
          },
          { path: 'brand', element: <BrandView /> },
          { path: 'looks', element: <LooksView /> },
          { path: 'looks/:lookId', element: <LookRoute /> },
          { path: 'p/*', element: <LegacyProjectRedirect /> },
          // a shot link from before the split still opens the shot
          { path: 'n/:nodeId', element: <LegacyShotRedirect /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
