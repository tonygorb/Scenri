import { assetUrl, type DemoProduct, type Presenter, type Product, type Scene } from '../api.js';
import type { Swatch } from '../brand/palette.js';
import { isRecommendedPresenter, isRecommendedScene } from '../compat.js';
import { productLabel, productSearchText, presenterSearchText, sceneLabel, sceneSearchText } from '../displayName.js';
import { matchesQuery, pageSlice } from '../layout/library/libraryRules.js';
import { normalizeTint, type SentenceToken } from './line.js';

/**
 * The three ingredients a chip can hold that are picked from a visual catalog.
 *
 * Colours open a compact palette menu of their own. References and brand
 * marks are chips too, but they are not catalogs you browse by eye — a
 * reference is one of the last six shots. They keep the caret; only these
 * three get IngredientPicker.
 */
export type IngredientKind = 'product' | 'presenter' | 'scene';

/** What the picker calls the thing, in headings, buttons and aria labels. */
export const NOUN: Record<IngredientKind, string> = {
  product: 'product',
  presenter: 'presenter',
  scene: 'scene',
};

/** Cards before "Show more". Twelve rows of four, which is most of a catalog. */
export const PAGE = 48;

/**
 * One thing that could be picked.
 *
 * Deliberately flat and pre-resolved: the picker never reaches back into a
 * catalog to render a card, so a product, a presenter and a scene draw through
 * exactly the same component and the differences between them live here.
 */
export interface Candidate {
  kind: IngredientKind;
  id: string;
  /** The caption. `productLabel(p,'card')` / `p.name` / `sceneLabel(s,'card')`. Never `promptName`. */
  label: string;
  /** The whole structured truth, for `title=`. Never rendered inline. */
  full: string;
  /** Second caption line: the format, the casting descriptor, the light. */
  sub?: string;
  /** Matched on, never shown. Keywords, pre-rename names, the casting sheet. */
  search: string;
  thumb?: string | null;
  /** Scenes only: the preview's own hue, normalized. */
  tint?: string;
  /**
   * Set when `thumb` is a 4:5 card crop rather than a square head crop, so a
   * square tile can pull the framing up instead of cropping the face off.
   *
   * A presenter this brand built often has no square avatar — `brandAssets`
   * refuses to claim the 4:5 preview as one, on purpose, because a circle
   * needs the real zoom. A square tile can do better than nothing: shift the
   * framing rather than centre it and render a torso.
   */
  crop?: 'top';
  /** `brand` = the user's own upload or import; `catalog` = scenri's. */
  source: 'brand' | 'catalog';
  /** A hint from compat.ts, never a gate. Only set for scenes and presenters. */
  recommended?: boolean;
  /**
   * Stamped by `pickList`, scenes only: this one is on the brand's shortlist.
   *
   * The rank band already lifts it; this is what lets a row say why it is
   * near the top instead of looking arbitrarily ordered.
   */
  bookmarked?: boolean;
  /** What picking this produces. */
  token: SentenceToken;
}

/** Everything the three catalogs need, in the shapes the app already holds them. */
export interface IngredientCatalog {
  /** The brand's imported/uploaded library, when it has loaded. */
  libraryProducts: Product[];
  /** `brand.json.products` — the fallback the composer already falls back to. */
  brandProducts: Product[];
  demoProducts: DemoProduct[];
  presenters: Presenter[];
  /** `brand.json.characters` — a roster from before the presenter catalog existed. */
  cast: Product[];
  scenes: Scene[];
  /** Drives the "Suited to X" section. See compat.ts. */
  productCategory: string | null;
}

/**
 * Which picker a chip opens, or null for the chips that keep the caret menu.
 *
 * Not `groupOf`: that returns display strings for six groups and has to keep
 * doing so for TokenMenu. This is the narrow question, with an answer a switch
 * can be exhaustive about.
 */
export function pickerKind(t: SentenceToken | null | undefined): IngredientKind | null {
  if (!t) return null;
  if (t.t === 'product') return 'product';
  if (t.t === 'character') return 'presenter';
  if (t.t === 'template') return 'scene';
  return null;
}

/**
 * Which chip-anchored surface opens, if any.
 *
 * `pickerKind` is the three visual catalogs. A colour chip opens a smaller
 * palette menu; a reference or a mark still has nothing to swap to.
 */
export type ChipPickerKind = IngredientKind | 'color';

export function chipOpensPicker(t: SentenceToken | null | undefined): ChipPickerKind | null {
  const kind = pickerKind(t);
  if (kind) return kind;
  if (t?.t === 'color') return 'color';
  return null;
}

const clean = (s: string | null | undefined): string | undefined => {
  const t = (s ?? '').trim();
  return t ? t : undefined;
};

/**
 * Whether a scene or presenter is this brand's own rather than scenri's.
 *
 * `custom: true` is set once, by the adapters in `brandAssets.ts`, on the way
 * out of the brand document — so this asks the record instead of inferring
 * ownership from which array an item happened to be in.
 */
const isOwn = (x: unknown): boolean => (x as { custom?: boolean } | null)?.custom === true;

/**
 * Every option of one kind, in catalog order.
 *
 * This is the single source for Products, Presenters and Scenes: the picker
 * draws cards from it and TokenMenu's rows are mapped from it. Both surfaces
 * used to build their own lists, which is how the caret menu ended up unable
 * to reach a demo product or search a presenter's casting sheet while the
 * attach panel could do both.
 */
export function buildCandidates(kind: IngredientKind, cat: IngredientCatalog): Candidate[] {
  if (kind === 'product') {
    // The composer's existing precedence: the live library wins, and
    // brand.json is what a brand with no import still has.
    const own = cat.libraryProducts.length ? cat.libraryProducts : cat.brandProducts;
    return [
      ...own.map((p): Candidate => productCandidate(p, 'brand', assetUrl(p.shots?.[0]?.file))),
      ...cat.demoProducts.map((p): Candidate => productCandidate(p, 'catalog', p.previewUrl ?? null)),
    ];
  }

  if (kind === 'presenter') {
    return [
      ...cat.presenters.map(
        (p): Candidate => ({
          kind: 'presenter',
          id: p.id,
          label: p.name,
          full: [p.name, clean(p.descriptor)].filter(Boolean).join(' · '),
          sub: clean(p.descriptor),
          search: presenterSearchText(p),
          // Square first: a 1:1 box crops the head off the 4:5 casting card.
          thumb: p.avatarUrl ?? p.previewUrl ?? null,
          crop: p.avatarUrl ? undefined : 'top',
          // This list arrives already merged (`withCustomFirst`), so it is not
          // all scenri's. A person this brand cast for itself carries `custom`
          // and is as much theirs as an uploaded product is.
          source: isOwn(p) ? 'brand' : 'catalog',
          recommended: isRecommendedPresenter(p, cat.productCategory),
          token: { t: 'character', id: p.id },
        }),
      ),
      // A roster from before the presenter catalog existed. The chip already
      // resolves these first, so without them a legacy chip had no card to tick.
      ...cat.cast.map(
        (c): Candidate => ({
          kind: 'presenter',
          id: c.id,
          label: c.name,
          full: c.name,
          search: c.name,
          thumb: assetUrl(c.shots?.[0]?.file),
          crop: 'top',
          source: 'brand',
          token: { t: 'character', id: c.id },
        }),
      ),
    ];
  }

  return cat.scenes.map(
    (s): Candidate => ({
      kind: 'scene',
      id: s.id,
      label: sceneLabel(s, 'card'),
      full: sceneLabel(s, 'tooltip'),
      sub: clean(s.lighting),
      search: sceneSearchText(s),
      thumb: s.previewUrl ?? null,
      tint: normalizeTint(s.previewColor),
      // Same merged list as presenters: a scene this brand built carries
      // `custom`. Hardcoding 'catalog' here made every own scene read as ours.
      source: isOwn(s) ? 'brand' : 'catalog',
      recommended: isRecommendedScene(s, cat.productCategory),
      token: { t: 'template', id: s.id },
    }),
  );
}

function productCandidate(p: Product | DemoProduct, source: 'brand' | 'catalog', thumb: string | null): Candidate {
  return {
    kind: 'product',
    id: p.id,
    /**
     * The bare name, which is what the chip will say.
     *
     * `'card'` is the catalog-tile budget and prefixes the brand, which in a
     * 92px cell spent the whole visible width on it: every card in the scenri
     * library read "Birchwood Page ...", and the chip it produced then said
     * "Leather Derby". Same object, two different words, in two surfaces a
     * click apart. A picker cell has a chip's budget, so it composes the parts
     * the way a chip does and puts the brand on the line underneath, where it
     * separates two similar products without hiding either of them.
     */
    label: productLabel(p, 'chip'),
    full: productLabel(p, 'tooltip'),
    sub: productSub(p),
    search: productSearchText(p),
    thumb,
    source,
    // No product-to-product compatibility exists, and a "recommended" badge
    // with nothing behind it is worse than none. See compat.ts.
    token: { t: 'product', id: p.id },
  };
}

/**
 * The line under a product's name: who makes it.
 *
 * The brand and nothing else. It used to carry the format too, which at 96px
 * truncated to "Almanac Supply · ..." — the same line of noise a scene's
 * lighting phrase was making before it was taken out. The picture already
 * shows the format, because a can looks like a can; the brand is the one thing
 * about a product a photograph cannot say. The format is still in the tooltip
 * and still searchable.
 */
function productSub(p: Product | DemoProduct): string | undefined {
  const anyP = p as Product & DemoProduct;
  return clean(anyP.brand) ?? clean(anyP.vendor);
}

/** AND-match over the hidden haystack. The library matcher, not a second one. */
export function filterCandidates(items: Candidate[], query: string): Candidate[] {
  const q = query.trim();
  if (!q) return items;
  return items.filter((c) => matchesQuery(c.search, q));
}

/**
 * What the picker shows: what is on, and everything else, best first.
 *
 * There are no sections. Three kinds of thing were growing three different
 * section models — bookmarked/suited/all for a scene, suited/all for a
 * presenter, yours/scenri for a product — which is three layouts to learn for
 * one job. The same information is order instead: a lift, not a heading, which
 * is what the library pages already do (`bookmarkedFirst`). One list, one rule,
 * and a small bookmark on the row that was lifted, so the order explains
 * itself rather than looking arbitrary.
 */
export interface PickList {
  /** What the chip holds, when the catalog still has it. */
  current: Candidate | null;
  /** Everything else, ranked and capped. */
  items: Candidate[];
  /** How many more matched than are drawn. Never truncate silently. */
  remaining: number;
  total: number;
}

/**
 * Where a candidate sits before catalog order decides the rest.
 *
 * Deliberately blunt: two or three bands per kind, with a stable sort inside
 * each, so the order a catalog was authored in survives underneath the lift.
 */
function rank(kind: IngredientKind, c: Candidate, bookmarked: ReadonlySet<string>): number {
  // Yours outranks ours, in every kind. This used to hold for products alone,
  // which meant a *suggested* scenri presenter sorted above the person this
  // brand cast for itself — a hint beating an owner. Ownership is the one
  // thing the panel never has to explain, so it leads, and the shortlist and
  // suitability order what is left.
  if (c.source === 'brand') return 0;
  if (kind === 'scene') return bookmarked.has(c.id) ? 1 : c.recommended ? 2 : 3;
  if (kind === 'presenter') return c.recommended ? 1 : 2;
  return 1;
}

export function pickList(
  kind: IngredientKind,
  items: Candidate[],
  o: { currentId: string | null; query: string; bookmarked: ReadonlySet<string>; shown?: number },
): PickList {
  const current = o.currentId ? (items.find((c) => c.id === o.currentId) ?? null) : null;
  const pool = current ? items.filter((c) => c.id !== current.id) : items;
  const hits = filterCandidates(pool, o.query);
  // Array#sort is stable, so catalog order holds inside every band.
  const ranked = [...hits]
    .sort((a, b) => rank(kind, a, o.bookmarked) - rank(kind, b, o.bookmarked))
    // Stamped here rather than read at each render site, so the rail and the
    // chip picker can never disagree about which rows were lifted.
    .map((c) => (o.bookmarked.has(c.id) ? { ...c, bookmarked: true } : c));
  const { visible, remaining } = pageSlice(ranked, o.shown ?? PAGE);
  return { current, items: visible, remaining, total: ranked.length };
}

/** A caret insert, not a command. `$` a product, `/` a scene, `@` a presenter, `#` a colour. */
export type InsertSigil = '$' | '/' | '@' | '#';

export const INSERT_KIND: Record<Exclude<InsertSigil, '#'>, IngredientKind> = {
  $: 'product',
  '/': 'scene',
  '@': 'presenter',
};

/** Rows a typed query will draw. Past this, typing is faster than scrolling. */
export const INSERT_CAP = 40;

/**
 * Empty-query cap. Opening `$` on a 700-product library used to dump the
 * first forty; a shortlist is what makes typing the obvious next move.
 */
export const INSERT_EMPTY = {
  Products: 8,
  Presenters: 8,
  Colors: 16,
  Scenes: 8,
} as const;

export type InsertGroup = keyof typeof INSERT_EMPTY;

export const INSERT_LABEL: Record<InsertSigil, InsertGroup> = {
  $: 'Products',
  '/': 'Scenes',
  '@': 'Presenters',
  '#': 'Colors',
};

/** What TokenMenu renders. `run` is attached at the call site. */
export interface InsertChoice {
  key: string;
  group: InsertGroup;
  label: string;
  hint?: string;
  search?: string;
  thumb?: string;
  swatch?: string;
  token: SentenceToken;
}

function fromCandidate(c: Candidate): InsertChoice {
  return {
    key: `${c.kind}:${c.id}`,
    group: c.kind === 'presenter' ? 'Presenters' : c.kind === 'scene' ? 'Scenes' : 'Products',
    label: c.label,
    hint: c.sub,
    search: c.search,
    thumb: c.thumb ?? undefined,
    token: c.token,
  };
}

function rankedKind(
  kind: IngredientKind,
  items: Candidate[],
  bookmarked: ReadonlySet<string>,
  shown: number,
): InsertChoice[] {
  return pickList(kind, items, { currentId: null, query: '', bookmarked, shown }).items.map(fromCandidate);
}

/**
 * What `$` `/` `@` `#` show. One catalog each — never a mixed list.
 *
 * `$` products, `/` scenes, `@` presenters, `#` brand colours.
 * Marks and shots stay on the attach panel.
 */
export function insertShortlist(
  sigil: InsertSigil,
  pools: {
    products: Candidate[];
    presenters: Candidate[];
    scenes?: Candidate[];
    colors?: Swatch[];
  },
  o: { query: string; bookmarked?: ReadonlySet<string> } = { query: '' },
): InsertChoice[] {
  const q = o.query.trim();
  const bookmarked = o.bookmarked ?? new Set<string>();
  if (sigil === '#') {
    const colors = (pools.colors ?? []).map(fromSwatch);
    if (!q) return colors.slice(0, INSERT_EMPTY.Colors);
    return colors.filter((c) => matchesQuery(c.search ?? c.label, q)).slice(0, INSERT_CAP);
  }
  const kind = INSERT_KIND[sigil];
  const items =
    kind === 'product' ? pools.products : kind === 'presenter' ? pools.presenters : (pools.scenes ?? []);
  if (!q) return rankedKind(kind, items, bookmarked, INSERT_EMPTY[INSERT_LABEL[sigil]]);
  return filterCandidates(items, q)
    .map(fromCandidate)
    .slice(0, INSERT_CAP);
}

function fromSwatch(s: Swatch): InsertChoice {
  return {
    key: `color:${s.hex}`,
    group: 'Colors',
    label: s.name,
    hint: s.hex,
    search: `${s.name} ${s.hex}`,
    swatch: s.hex,
    token: { t: 'color', hex: s.hex, name: s.name || undefined },
  };
}
