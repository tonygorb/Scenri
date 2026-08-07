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
 */
const CATEGORY_TO_VERTICAL: Record<string, string> = {
  fragrance: 'Fragrance',
  footwear: 'Footwear',
  apparel: 'Apparel',
  furniture: 'Home',
  beauty: 'Beauty',
  electronics: 'Electronics',
  accessories: 'Accessories',
  beverage: 'Beverages',
};

function vertical(productCategory: string | null | undefined): string | null {
  return (productCategory && CATEGORY_TO_VERTICAL[productCategory]) || null;
}

export function isRecommendedScene(
  scene: Pick<Scene, 'verticals'>,
  productCategory: string | null | undefined,
): boolean {
  const v = vertical(productCategory);
  return !!v && scene.verticals.includes(v);
}

export function isRecommendedPresenter(
  presenter: Pick<Presenter, 'suitableCategories'>,
  productCategory: string | null | undefined,
): boolean {
  const v = vertical(productCategory);
  return !!v && presenter.suitableCategories.includes(v);
}
