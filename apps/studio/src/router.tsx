import { Navigate, createBrowserRouter, useLocation, useParams, useRouteError } from 'react-router';
import { Callout, Flex } from '@radix-ui/themes';
import { AppShell } from './app/AppShell.js';
import { BrandLayout, useBrand } from './app/BrandLayout.js';
import { brandPath } from './app/brandPath.js';
import { RootRedirect } from './app/RootRedirect.js';
import { BrandSetup } from './views/BrandSetup.js';
import { HomeView } from './views/Home.js';
import { BrandView } from './views/Brand.js';
import { LooksView } from './views/Looks.js';
import { LookPage } from './views/LookPage.js';
import { ProjectView } from './views/Project.js';
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
 * Turns the path segment into a project. It is the slug, but an id still
 * resolves and rewrites itself, so older links and anything holding an id keep
 * landing in the right place.
 *
 * React Router keeps a component mounted when only a param changes, and
 * ProjectView carries per-project drafts (text layers, a pending remix) that
 * must not follow you into the next project. Keying on the id restores the
 * clean slate the old route switch gave for free.
 */
function ProjectRoute() {
  const { projectId = '' } = useParams();
  const { pathname, search } = useLocation();
  const { brand, projects, projectsLoaded } = useBrand();
  const project = projects.find((p) => p.slug === projectId) ?? projects.find((p) => p.id === projectId) ?? null;

  // nothing to resolve against until the brand's projects land
  if (!projectsLoaded) return null;
  // a deleted project, or a link from another machine
  if (!project) return <Navigate to={brandPath(brand)} replace />;
  if (project.slug !== projectId) {
    // keep whatever follows, so /n/:nodeId survives the rewrite
    const seg = pathname.split('/');
    seg[4] = project.slug;
    return <Navigate to={seg.join('/') + search} replace />;
  }
  return <ProjectView key={project.id} project={project} />;
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
          { index: true, element: <HomeView /> },
          { path: 'brand', element: <BrandView /> },
          { path: 'looks', element: <LooksView /> },
          { path: 'looks/:lookId', element: <LookRoute /> },
          {
            path: 'p/:projectId',
            element: <ProjectRoute />,
            // the shot overlay is a child route, so opening one keeps the
            // canvas mounted and does not refetch the tree
            children: [{ path: 'n/:nodeId', element: <ShotDetailRoute /> }],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
