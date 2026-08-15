import { assetUrl, type DemoProduct, type Presenter, type Product, type Scene } from '../api.js';
import { isRecommendedPresenter, isRecommendedScene } from '../compat.js';
import { productLabel, productSearchText, presenterSearchText, sceneLabel, sceneSearchText } from '../displayName.js';
import { matchesQuery, pageSlice } from '../layout/library/libraryRules.js';
import { normalizeTint, type SentenceToken } from './line.js';

/**
 * The three ingredients a chip can hold that are picked from a visual catalog.
 *
 * Colours, references and brand marks are chips too, but they are not catalogs
 * you browse by eye — a swatch is its own label and a reference is one of the
 * last six shots. They keep the caret menu; only these three get a picker.
 */
export type IngredientKind = 'product' | 'presenter' | 'scene';

/** What the picker calls the thing, in headings, buttons and aria labels. */
export const NOUN: Record<IngredientKind, string> = {
  product: 'product',
  presenter: 'presenter',
  scene: 'scene',
};

/** Cards per section before "Show more". Six rows of four in a 440px panel. */
export const PAGE = 24;

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
  /** `brand` = the user's own upload or import; `catalog` = scenri's. */
  source: 'brand' | 'catalog';
  /** A hint from compat.ts, never a gate. Only set for scenes and presenters. */
  recommended?: boolean;
  /** What picking this produces. */
  token: SentenceToken;
}

export type SectionId = 'current' | 'starred' | 'suited' | 'mine' | 'library' | 'all' | 'results';

export interface Section {
  id: SectionId;
  title: string;
  items: Candidate[];
  /** How many of `total` are not drawn yet. Above zero, say so out loud. */
  remaining: number;
  total: number;
  /** Only `mine` sets this, so the Add-product card leads that grid. */
  leadWithAdd?: boolean;
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

const clean = (s: string | null | undefined): string | undefined => {
  const t = (s ?? '').trim();
  return t ? t : undefined;
};

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
          source: 'catalog',
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
      source: 'catalog',
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
 * The line under a product's name: who makes it, and what shape it comes in.
 *
 * The qualifier is dropped when it only restates the name. A watch called
 * "Field Watch" with the format "Field watch" produced "Aldergate · Field
 * watch" under the words "Field Watch", which reads as a mistake rather than as
 * information.
 */
function productSub(p: Product | DemoProduct): string | undefined {
  const anyP = p as Product & DemoProduct;
  const brand = clean(anyP.brand) ?? clean(anyP.vendor);
  const qualifier = clean(anyP.format) ?? clean(anyP.subcategory) ?? clean(anyP.variant);
  const same = qualifier && qualifier.toLowerCase() === p.name.toLowerCase();
  return [brand, same ? undefined : qualifier].filter(Boolean).join(' · ') || undefined;
}

/** AND-match over the hidden haystack. The library matcher, not a second one. */
export function filterCandidates(items: Candidate[], query: string): Candidate[] {
  const q = query.trim();
  if (!q) return items;
  return items.filter((c) => matchesQuery(c.search, q));
}

export interface SectionOptions {
  /** The id the chip currently holds, whether or not it still resolves. */
  currentId: string | null;
  query: string;
  /** Scenes only; empty for the other two, which have no favourites. */
  starred: ReadonlySet<string>;
  /** "Suited to Beverage". Null omits the section entirely. */
  categoryTitle: string | null;
  /** How many cards each section has been asked to draw so far. */
  shown: Partial<Record<SectionId, number>>;
}

/**
 * The picker's whole information architecture, as data.
 *
 * A search collapses every kind to one list. Sections are how you browse; a
 * query is how you aim, and pinning the current item above a filter it does
 * not match would be a lie about what the filter did. Nothing is a tab: the
 * whole point of this surface is that one scroll answers "what else is there".
 */
export function sectionsFor(kind: IngredientKind, items: Candidate[], o: SectionOptions): Section[] {
  const q = o.query.trim();
  if (q) {
    const hits = filterCandidates(items, q);
    return [page({ id: 'results', title: 'Results', items: hits }, o.shown.results)];
  }

  const current = o.currentId ? (items.find((c) => c.id === o.currentId) ?? null) : null;
  const isCurrent = (c: Candidate) => !!current && c.id === current.id;
  const out: Section[] = [];
  // A chip whose id no longer resolves has no card to show. The picker says so
  // in its footer instead of silently opening with nothing selected.
  if (current) out.push({ id: 'current', title: 'Current', items: [current], remaining: 0, total: 1 });

  if (kind === 'product') {
    const mine = items.filter((c) => c.source === 'brand' && !isCurrent(c));
    const library = items.filter((c) => c.source === 'catalog' && !isCurrent(c));
    // Always rendered, even at zero, because the Add card needs a home and an
    // empty products page is exactly when adding one is the thing to do.
    out.push({ ...page({ id: 'mine', title: 'Your products', items: mine }, o.shown.mine), leadWithAdd: true });
    if (library.length) out.push(page({ id: 'library', title: 'Scenri library', items: library }, o.shown.library));
    return out;
  }

  // A lift only earns its heading when it is actually drawn. Anything lifted
  // into a section that never renders has to fall back into the remainder, or
  // the picker would quietly stop offering it at all.
  const starred = kind === 'scene' ? items.filter((c) => o.starred.has(c.id) && !isCurrent(c)) : ([] as Candidate[]);
  const lifted = new Set(starred.map((c) => c.id));
  const suited = o.categoryTitle ? items.filter((c) => c.recommended && !lifted.has(c.id) && !isCurrent(c)) : [];
  for (const c of suited) lifted.add(c.id);
  const rest = items.filter((c) => !lifted.has(c.id) && !isCurrent(c));

  if (starred.length) out.push(page({ id: 'starred', title: 'Starred', items: starred }, o.shown.starred));
  if (suited.length)
    out.push(page({ id: 'suited', title: `Suited to ${o.categoryTitle}`, items: suited }, o.shown.suited));
  // Starred and suited already lifted what they lift; re-sorting the remainder
  // would only scramble the order the catalog was authored in.
  out.push(page({ id: 'all', title: kind === 'scene' ? 'All scenes' : 'All presenters', items: rest }, o.shown.all));
  return out;
}

/** Never a silent truncation: `remaining` is what the section owes the reader. */
function page(s: { id: SectionId; title: string; items: Candidate[] }, shown: number | undefined): Section {
  const { visible, remaining } = pageSlice(s.items, shown ?? PAGE);
  return { id: s.id, title: s.title, items: visible, remaining, total: s.items.length };
}
