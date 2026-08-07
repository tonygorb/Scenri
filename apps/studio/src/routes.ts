import { generatePath } from 'react-router';
import type { Brand, ShotSet } from './api.js';

/**
 * Every path this app has, in one place, twice: once as the pattern the route
 * table and `useMatch` speak, once as the builder every navigation calls.
 *
 * They have to agree, which is the whole reason they are neighbours. Before
 * this file one URL was spelled four ways — the route table, twenty-three
 * template literals hung off a `brandPath` prefix, `useMatch` against a literal
 * string, and a `startsWith`/`slice` on the pathname — and only the first of
 * them was ever kept current.
 *
 * The patterns are absolute. React Router accepts an absolute child path so
 * long as it starts with its parent's combined path, so the same constant
 * serves the route table, `useMatch` and `generatePath` with nothing rewritten
 * in between.
 *
 * The segments are words. `/b/`, `/s/` and `/n/` read as a link shortener
 * rather than an app, and `n` said "node" while every label in the UI says
 * shot. A brand sits at the root because it is this app's workspace, and a
 * workspace is what the first segment means everywhere else on the web.
 */
export const P = {
  root: '/',
  setup: '/setup',
  brand: '/:brandSlug',
  kit: '/:brandSlug/kit',
  products: '/:brandSlug/products',
  product: '/:brandSlug/products/:productId',
  scenes: '/:brandSlug/scenes',
  scene: '/:brandSlug/scenes/:sceneId',
  presenters: '/:brandSlug/presenters',
  presenter: '/:brandSlug/presenters/:presenterId',
  hub: '/:brandSlug/create',
  hubShot: '/:brandSlug/create/shots/:shotId',
  set: '/:brandSlug/sets/:setSlug',
  setShot: '/:brandSlug/sets/:setSlug/shots/:shotId',
  /** The whole of the old `/b/` scheme. Only the redirect shim matches it. */
  legacy: '/b/*',
  notFound: '*',
} as const;

type BrandLike = Pick<Brand, 'slug'>;
type SetLike = Pick<ShotSet, 'slug'>;

/**
 * Builders take the row, not its slug, so no call site has to remember that the
 * address bar spells a brand by slug while every fetch and every stored
 * preference still goes by id. `generatePath` percent-encodes what it is
 * given, which slugs never need — they are ASCII by construction — but it means
 * a slug that somehow was not cannot break the path it lands in.
 */
export const brandPath = (b: BrandLike): string => generatePath(P.brand, { brandSlug: b.slug });
export const kitPath = (b: BrandLike): string => generatePath(P.kit, { brandSlug: b.slug });
export const productsPath = (b: BrandLike): string => generatePath(P.products, { brandSlug: b.slug });
export const productPath = (b: BrandLike, productId: string): string =>
  generatePath(P.product, { brandSlug: b.slug, productId });
export const scenesPath = (b: BrandLike): string => generatePath(P.scenes, { brandSlug: b.slug });
export const scenePath = (b: BrandLike, sceneId: string): string =>
  generatePath(P.scene, { brandSlug: b.slug, sceneId });
export const presentersPath = (b: BrandLike): string => generatePath(P.presenters, { brandSlug: b.slug });
export const presenterPath = (b: BrandLike, presenterId: string): string =>
  generatePath(P.presenter, { brandSlug: b.slug, presenterId });
export const hubPath = (b: BrandLike): string => generatePath(P.hub, { brandSlug: b.slug });
export const setPath = (b: BrandLike, s: SetLike): string =>
  generatePath(P.set, { brandSlug: b.slug, setSlug: s.slug });

/**
 * A shot, in whichever surface is holding it. The hub and a set are the same
 * screen wearing a different filter, so the overlay opens under either — and
 * the caller usually has the set or null already, rather than a decision to
 * make.
 */
export const shotPath = (b: BrandLike, set: SetLike | null, shotId: string): string =>
  set
    ? generatePath(P.setShot, { brandSlug: b.slug, setSlug: set.slug, shotId })
    : generatePath(P.hubShot, { brandSlug: b.slug, shotId });

/**
 * An old `/b/…` URL, rewritten into the current scheme.
 *
 * Deep links outlive the release that made them: tasks.ts persists notification
 * hrefs into localStorage, so an upgrade inherits a feed full of `/b/<brand>/…`.
 * Two of the shapes here were already legacy before this rename — `/p/*` from
 * when sets were projects, and a shot at the brand root from before the overlay
 * moved under the hub — so this is one rewrite rather than the three separate
 * redirect components it replaces.
 *
 * A slug where the new scheme wants a slug is passed straight through, and an
 * id in the same place is fine too: BrandLayout and SetRoute already resolve
 * either and rewrite to the slug spelling once they can.
 */
export function rewriteLegacyPath(pathname: string, search = ''): string {
  const [, , brandSlug, ...rest] = pathname.split('/');
  if (!brandSlug) return P.root;

  const path = `/${brandSlug}${legacyTail(rest)}`;
  return search ? path + search : path;
}

function legacyTail(rest: string[]): string {
  const [head, a, b, c] = rest;
  // the hub, with or without a shot open on it
  if (head === 'create') return b && a === 'n' ? `/create/shots/${b}` : '/create';
  // a set, with or without a shot open on it
  if (head === 's' && a) return c && b === 'n' ? `/sets/${a}/shots/${c}` : `/sets/${a}`;
  // the kit page, which used to stutter: /b/<brand>/brand
  if (head === 'brand') return '/kit';
  // projects are gone; their shots are on the hub, which is where a project
  // link was always trying to go
  if (head === 'p') return '/create';
  // a shot that predates the overlay moving under the hub
  if (head === 'n' && a) return `/create/shots/${a}`;
  // scenes (formerly looks) were always spelled out, and anything unrecognised
  // is left alone so a future segment does not have to be taught to this
  // function to survive it
  return rest.length ? `/${rest.join('/')}` : '';
}
