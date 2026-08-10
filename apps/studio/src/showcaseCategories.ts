/**
 * The homepage gallery is grouped by **use case**, not by product category.
 *
 * Grouping it the way every other surface is grouped — accessories, apparel,
 * beauty — made the homepage read as a second copy of the Scenes catalog. The
 * Scenes page answers "what lighting do I want?"; the homepage answers "what
 * could I make with this for my work?", and those are different questions that
 * deserve different shelves.
 */
export const SHOWCASE_CATEGORIES: { key: string; label: string }[] = [
  { key: 'campaign', label: 'Product campaign' },
  { key: 'lifestyle', label: 'Lifestyle' },
  { key: 'editorial', label: 'Fashion & editorial' },
  { key: 'beauty', label: 'Beauty' },
  { key: 'food-drink', label: 'Food & drink' },
  { key: 'launch', label: 'Tech launch' },
  { key: 'social', label: 'Social' },
  { key: 'cinematic', label: 'Cinematic' },
  { key: 'catalog', label: 'Catalog' },
  { key: 'seasonal', label: 'Seasonal' },
];

const BY_KEY = new Map(SHOWCASE_CATEGORIES.map((c) => [c.key, c]));

/** Falls back to the raw key, so an unknown category still renders as a tab. */
export function showcaseCategoryLabel(key: string | null | undefined): string | null {
  return key ? (BY_KEY.get(key)?.label ?? key) : null;
}

/** Catalog order, so the tabs never reshuffle as entries come and go. */
export function sortShowcaseCategories(keys: string[]): string[] {
  const order = new Map(SHOWCASE_CATEGORIES.map((c, i) => [c.key, i]));
  return [...keys].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b));
}
