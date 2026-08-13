import type { DemoProduct, Presenter, Product, Scene } from './api.js';

/**
 * One display name never fits every surface. A composer chip has ~15
 * characters of room and already sits inside a sentence that supplies the
 * context; a catalog card has a line and no context at all; a tooltip has as
 * much room as it likes and is the place the full truth belongs.
 *
 * Rather than truncating one long string differently in each place, catalog
 * entries carry structured parts — brand, short name, format — and each
 * surface composes the parts it has room for. This module is the only place
 * that composition happens, so "what does a product look like in a chip" has
 * exactly one answer.
 *
 * Never render `promptName`. It is the frozen descriptive phrase the engine is
 * sent, deliberately long, and it exists precisely so these labels can be short.
 */
export type LabelContext =
  /** Inside the composer sentence. Tightest budget; context comes from the sentence. */
  | 'chip'
  /** A catalog tile's caption. One line, ellipsis-capped. */
  | 'card'
  /** A detail page's <h1>. Wraps, so it can afford the brand. */
  | 'heading'
  /** Hover/long-press. The full structured truth, no truncation. */
  | 'tooltip';

interface Parts {
  name: string;
  brand: string | null;
  /** The physical format or variant — "330ml can", "Midnight Black, 42mm". */
  qualifier: string | null;
}

const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? '').trim();
  return t ? t : null;
};

/**
 * Demo products carry `brand`/`format`; a brand's own products carry the
 * store's `vendor`/`variant`. Same three roles, two spellings, because one
 * comes from our catalog and the other from a Shopify import.
 */
function productParts(p: DemoProduct | Product): Parts {
  const anyP = p as DemoProduct & Product;
  return {
    name: p.name,
    brand: clean(anyP.brand) ?? clean(anyP.vendor),
    qualifier: clean(anyP.format) ?? clean(anyP.subcategory) ?? clean(anyP.variant),
  };
}

/**
 * "Kova" + "Kova Peach Soda" must not become "Kova Kova Peach Soda". Catalog
 * imports routinely ship the vendor inside the title, and users type it too.
 */
function withBrand(parts: Parts): string {
  if (!parts.brand) return parts.name;
  if (parts.name.toLowerCase().startsWith(parts.brand.toLowerCase())) return parts.name;
  return `${parts.brand} ${parts.name}`;
}

export function productLabel(p: DemoProduct | Product, ctx: LabelContext): string {
  const parts = productParts(p);
  if (ctx === 'chip') return parts.name;
  const titled = withBrand(parts);
  if (ctx === 'tooltip') return [titled, parts.qualifier].filter(Boolean).join(' · ');
  return titled;
}

/**
 * Scenes have no brand, so the name stands alone everywhere. The tooltip adds
 * the lighting phrase, which is the one thing that most helps tell two
 * similarly-named scenes apart.
 */
export function sceneLabel(s: Pick<Scene, 'name' | 'lighting'>, ctx: LabelContext): string {
  if (ctx === 'tooltip') return [s.name, clean(s.lighting)].filter(Boolean).join(' · ');
  return s.name;
}

/**
 * Everything a search should match on, joined for the substring matcher in
 * `layout/library/libraryRules.ts`.
 *
 * This is what pays for the short names: "Ice Core" still answers to glacier,
 * frozen and crystalline, and to "Glacier Ice Core" — the name it shipped
 * under before the rename — because both live here rather than on the card.
 */
export function sceneSearchText(s: Scene): string {
  return [s.name, ...(s.legacyNames ?? []), ...(s.keywords ?? []), s.description, s.lighting, s.subject]
    .concat(s.collections ?? [], s.verticals ?? [])
    .filter(Boolean)
    .join(' ');
}

export function productSearchText(p: DemoProduct | Product): string {
  const anyP = p as DemoProduct & Product;
  return [
    p.name,
    ...(anyP.legacyNames ?? []),
    ...(anyP.keywords ?? []),
    anyP.brand,
    anyP.vendor,
    anyP.format,
    anyP.subcategory,
    anyP.variant,
    anyP.productType,
    ...(anyP.tags ?? []),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * A presenter is cast, not named — nobody remembers "Nadia", they remember
 * "the white-blonde pixie" or "someone for a fragrance shoot". So the whole
 * casting sheet is searchable even though the card shows only name and
 * descriptor: hair, skin, build and age are how people actually look for a
 * face, and wardrobe/style/presentation are how they look for a fit.
 */
export function presenterSearchText(p: Presenter): string {
  return [
    p.name,
    p.descriptor,
    p.presentation,
    p.ageRange,
    p.facial,
    p.skin,
    p.hair,
    p.build,
    p.wardrobeDefault,
    ...p.suitableCategories,
    ...p.suitableStyles,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * A showcase tile is found the way it was assembled: by its title, its
 * category, and the catalog entries its recipe was built from. The resolved
 * catalog objects go in whole — each one contributes its own search text,
 * keywords and pre-rename names included — so "sneaker" finds the Trail
 * Runner tile even though nothing on the tile says sneaker.
 */
export function showcaseSearchText(
  entry: { title: string; category: string },
  recipe: {
    product?: DemoProduct | Product | null;
    presenter?: Presenter | null;
    scene?: Scene | null;
  },
  categoryLabel?: string | null,
): string {
  return [
    entry.title,
    entry.category,
    categoryLabel,
    recipe.product ? productSearchText(recipe.product) : null,
    recipe.presenter ? presenterSearchText(recipe.presenter) : null,
    recipe.scene ? sceneSearchText(recipe.scene) : null,
  ]
    .filter(Boolean)
    .join(' ');
}
