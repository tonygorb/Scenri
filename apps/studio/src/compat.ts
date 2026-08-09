import type { Scene, Presenter } from './api.js';

/**
 * A hint, never a gate. A Scene excellent for fragrance can still be picked
 * for a chair — this only says which choices the structure itself already
 * suggests, so quality goes up without creativity going down.
 *
 * Both checks read fields that already existed for other reasons (a Scene's
 * `verticals`, a Presenter's `suitableCategories`) — a product's own
 * `category` (see productCategories.ts) is the only new piece. Scenes and
 * Presenters spell their industries out as capitalized words ("Fragrance",
 * "Beauty"), not this app's lowercase category keys, so this maps one to
 * the other rather than comparing keys directly. `other` and any category
 * with no real-world equivalent among the existing verticals never match —
 * a false "recommended" is worse than none at all.
 *
 * Scenes and Presenters use two genuinely different vocabularies (a Scene's
 * `verticals` is a fixed 10-word set; a Presenter's `suitableCategories` is
 * its own 16-word set, e.g. "Technology" and "Streetwear" have no scene
 * equivalent), so each gets its own alias list rather than sharing one map —
 * a single map previously left `beverage` matching no real scene (mapped to
 * "Beverages", but every scene spells it "Food & drink") and `electronics`
 * matching no real presenter (mapped to "Electronics", but presenters use
 * "Technology"). A category may alias to more than one word on either side.
 */
const CATEGORY_TO_SCENE_VERTICAL: Record<string, string[]> = {
  fragrance: ['Fragrance'],
  footwear: ['Footwear'],
  apparel: ['Apparel'],
  furniture: ['Furniture', 'Home'],
  beauty: ['Beauty'],
  electronics: ['Electronics'],
  accessories: ['Accessories'],
  beverage: ['Food & drink'],
  jewelry: ['Jewelry'],
  food: ['Food & drink'],
};

const CATEGORY_TO_PRESENTER_CATEGORY: Record<string, string[]> = {
  fragrance: ['Fragrance'],
  footwear: ['Footwear', 'Apparel'],
  apparel: ['Apparel', 'Fashion', 'Streetwear'],
  furniture: ['Furniture', 'Home'],
  beauty: ['Beauty', 'Wellness'],
  electronics: ['Electronics', 'Technology'],
  accessories: ['Accessories'],
  beverage: ['Beverages', 'Food & drink'],
  jewelry: ['Jewelry'],
  food: ['Beverages', 'Food & drink'],
};

export function isRecommendedScene(
  scene: Pick<Scene, 'verticals'>,
  productCategory: string | null | undefined,
): boolean {
  if (!productCategory) return false;
  const aliases = CATEGORY_TO_SCENE_VERTICAL[productCategory];
  return !!aliases && aliases.some((v) => scene.verticals.includes(v));
}

export function isRecommendedPresenter(
  presenter: Pick<Presenter, 'suitableCategories'>,
  productCategory: string | null | undefined,
): boolean {
  if (!productCategory) return false;
  const aliases = CATEGORY_TO_PRESENTER_CATEGORY[productCategory];
  return !!aliases && aliases.some((c) => presenter.suitableCategories.includes(c));
}
