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
  /**
   * Places. In code a place is still a scene (the brand document's `scenes[]`,
   * the API, the types): only the words a person reads and the address they
   * hold moved, in 0.22. The old `/scenes` address redirects (`legacyScenes`).
   */
  scenes: '/:brandSlug/places',
  /**
   * The scene studio, a page like the presenter's: the picture has to be
   * judged at a size a dialog cannot give it, and editing a scene is the same
   * surface, so both have an address. The static `new` outranks `:sceneId`.
   * The last segment is the conversation, minted on the way in: work started in
   * it outlives the page, and Back, a reload or Activity lands on it again.
   */
  sceneStudio: '/:brandSlug/places/new/:convoId?',
  scene: '/:brandSlug/places/:sceneId',
  /** The same studio over a saved scene's own page, seeded from its record. */
  sceneEdit: '/:brandSlug/places/:sceneId/edit/:convoId?',
  /** People. In code a person is still a presenter, the way a place is a scene. */
  presenters: '/:brandSlug/people',
  /**
   * The presenter studio is a place, not a dialog: a person takes minutes,
   * five drawn views and a draft that outlives the session, so the draft
   * has an address and Back, reload and a shared link all land on it. One
   * route with the draft optional, so moving between a fresh start and a
   * draft keeps the studio mounted and the sentence in it. The static `new`
   * outranks `:presenterId`, so the two never collide.
   */
  presenterStudio: '/:brandSlug/people/new/:draftId?',
  presenter: '/:brandSlug/people/:presenterId',
  /** The editor: the same studio surface over the presenter's own page, with a session seeded from the record. */
  presenterEdit: '/:brandSlug/people/:presenterId/edit',
  hub: '/:brandSlug/create',
  hubShot: '/:brandSlug/create/shots/:shotId',
  set: '/:brandSlug/sets/:setSlug',
  setShot: '/:brandSlug/sets/:setSlug/shots/:shotId',
  /**
   * What changed in Scenri: help, not a place. It lights nothing in the bar,
   * because a nav slot has to earn itself against work done every session,
   * and it has an address so Help, Settings and the dialog's own link can land
   * on it and Back returns from it. Under a brand, like every page with chrome.
   */
  whatsNew: '/:brandSlug/whats-new',
  /** The whole of the old `/b/` scheme. Only the redirect shim matches it. */
  legacy: '/b/*',
  /** The addresses People and Places had before 0.22. Only the redirect shim matches them. */
  legacyPresenters: '/:brandSlug/presenters/*',
  legacyScenes: '/:brandSlug/scenes/*',
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
export const sceneStudioPath = (b: BrandLike, convoId?: string | null): string =>
  generatePath(P.sceneStudio, { brandSlug: b.slug, convoId: convoId ?? undefined });
export const sceneEditPath = (b: BrandLike, sceneId: string, convoId?: string | null): string =>
  generatePath(P.sceneEdit, { brandSlug: b.slug, sceneId, convoId: convoId ?? undefined });
export const presentersPath = (b: BrandLike): string => generatePath(P.presenters, { brandSlug: b.slug });
export const presenterPath = (b: BrandLike, presenterId: string): string =>
  generatePath(P.presenter, { brandSlug: b.slug, presenterId });
/** The studio, fresh or at a draft: one builder, since a draft is the same place further along. */
export const presenterStudioPath = (b: BrandLike, draftId?: string | null): string =>
  generatePath(P.presenterStudio, { brandSlug: b.slug, draftId: draftId ?? undefined });
export const presenterEditPath = (b: BrandLike, presenterId: string): string =>
  generatePath(P.presenterEdit, { brandSlug: b.slug, presenterId });
export const hubPath = (b: BrandLike): string => generatePath(P.hub, { brandSlug: b.slug });
export const setPath = (b: BrandLike, s: SetLike): string =>
  generatePath(P.set, { brandSlug: b.slug, setSlug: s.slug });
export const whatsNewPath = (b: BrandLike): string => generatePath(P.whatsNew, { brandSlug: b.slug });

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
  // people and places were always spelled out (once as presenters and scenes,
  // and scenes once as looks), and anything unrecognised is left alone so a
  // future segment does not have to be taught to this function to survive it
  return rest.length ? `/${[RENAMED[head] ?? head, ...rest.slice(1)].join('/')}` : '';
}

/**
 * The words a link seeds a brief with. Since 0.22 a link says `?person=` and
 * `?place=`; one from before says `?presenter=` and `?scene=`, and still works.
 * Read a seed through `seedParam`, never `params.get`, and drop it through
 * `SEED_KEYS`, so neither spelling is left behind in the address.
 */
const SEED = { presenter: 'person', scene: 'place' } as const;
export const seedParam = (params: URLSearchParams, kind: keyof typeof SEED): string | null =>
  params.get(SEED[kind]) ?? params.get(kind);
export const SEED_KEYS = ['person', 'presenter', 'place', 'scene'] as const;
/** `?person=<id>`: the canonical spelling every writer uses. */
export const seedQuery = (kind: keyof typeof SEED, id: string): string => `${SEED[kind]}=${encodeURIComponent(id)}`;

/** `?attach=places` opens the add panel on Places; `scenes` is the spelling from before 0.22. */
export const attachTabOf = (value: string | null): 'Places' | 'Products' | undefined =>
  value === 'places' || value === 'scenes' ? 'Places' : value === 'products' ? 'Products' : undefined;

/** `?new=person` and `?new=place` (and `presenter`/`scene` from before 0.22): the studios have addresses now. */
export const studioOfNew = (value: string | null): 'presenter' | 'scene' | null =>
  value === 'person' || value === 'presenter' ? 'presenter' : value === 'place' || value === 'scene' ? 'scene' : null;

/** The sections renamed in 0.22, by the segment they used to have. */
const RENAMED: Record<string, string> = { presenters: 'people', scenes: 'places' };

/**
 * `/<brand>/presenters/…` and `/<brand>/scenes/…`, as `/<brand>/people/…` and
 * `/<brand>/places/…`. Everything after the section (an id, `new`, a draft or a
 * conversation, `edit`) and the query and hash travel unchanged, because only
 * the section's name changed. Stored notification hrefs and bookmarks from
 * 0.21 and earlier are the reason this exists.
 */
export function rewriteRenamedPath(pathname: string, search = '', hash = ''): string {
  const [, brandSlug, head, ...rest] = pathname.split('/');
  return `/${[brandSlug, RENAMED[head] ?? head, ...rest].join('/')}${search}${hash}`;
}
