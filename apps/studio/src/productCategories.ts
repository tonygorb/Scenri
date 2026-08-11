/**
 * What "accurate" means for a product depends on what kind of object it is —
 * a fragrance bottle and a chair don't share a reference-angle plan, so this
 * is a lookup table rather than one fixed shot list. `ProductPage` renders
 * one tile per angle so a product can show exactly what it's missing; a
 * category with no photography conventions of its own falls back to `other`.
 */
export interface ProductAngle {
  key: string;
  label: string;
}

export interface ProductCategory {
  key: string;
  label: string;
  angles: ProductAngle[];
}

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  {
    key: 'fragrance',
    label: 'Fragrance',
    angles: [
      { key: 'three-quarter', label: 'Three-quarter' },
      { key: 'front', label: 'Front' },
      { key: 'side', label: 'Side' },
    ],
  },
  {
    key: 'footwear',
    label: 'Footwear',
    angles: [
      { key: 'three-quarter', label: 'Three-quarter' },
      { key: 'lateral-side', label: 'Lateral side' },
      { key: 'medial-side', label: 'Medial side' },
    ],
  },
  {
    key: 'apparel',
    label: 'Apparel',
    angles: [
      { key: 'front', label: 'Front' },
      { key: 'back', label: 'Back' },
      { key: 'detail-fabric', label: 'Detail / fabric' },
    ],
  },
  {
    key: 'furniture',
    label: 'Furniture',
    angles: [
      { key: 'three-quarter', label: 'Three-quarter' },
      { key: 'front', label: 'Front' },
      { key: 'side', label: 'Side' },
    ],
  },
  {
    key: 'beauty',
    label: 'Beauty / skincare',
    angles: [
      { key: 'three-quarter', label: 'Three-quarter' },
      { key: 'front', label: 'Front' },
      { key: 'label', label: 'Label' },
    ],
  },
  {
    key: 'electronics',
    label: 'Electronics',
    angles: [
      { key: 'three-quarter', label: 'Three-quarter' },
      { key: 'front', label: 'Front' },
      { key: 'back', label: 'Back' },
    ],
  },
  {
    key: 'jewelry',
    label: 'Jewelry',
    angles: [
      { key: 'three-quarter', label: 'Three-quarter' },
      { key: 'front', label: 'Front' },
      { key: 'clasp-detail', label: 'Clasp detail' },
    ],
  },
  {
    key: 'accessories',
    label: 'Accessories',
    angles: [
      { key: 'three-quarter', label: 'Three-quarter' },
      { key: 'front', label: 'Front' },
      { key: 'detail', label: 'Detail' },
    ],
  },
  {
    key: 'beverage',
    label: 'Beverage',
    angles: [
      { key: 'three-quarter', label: 'Three-quarter' },
      { key: 'front', label: 'Front' },
      { key: 'label', label: 'Label' },
    ],
  },
  {
    key: 'food',
    label: 'Food',
    angles: [
      { key: 'three-quarter', label: 'Three-quarter' },
      { key: 'front', label: 'Front' },
      { key: 'packaging-label', label: 'Packaging label' },
    ],
  },
  {
    key: 'other',
    label: 'Other',
    angles: [
      { key: 'three-quarter', label: 'Three-quarter' },
      { key: 'front', label: 'Front' },
      { key: 'side', label: 'Side' },
    ],
  },
];

const BY_KEY = new Map(PRODUCT_CATEGORIES.map((c) => [c.key, c]));

export const OTHER_CATEGORY: ProductCategory = BY_KEY.get('other')!;

export function categoryOf(key: string | null | undefined): ProductCategory {
  return (key && BY_KEY.get(key)) || OTHER_CATEGORY;
}

export function categoryLabel(key: string | null | undefined): string | null {
  return key ? (BY_KEY.get(key)?.label ?? key) : null;
}

/**
 * A starting guess only, from a catalog import's own taxonomy — never
 * authoritative, always overridable on the product's page. Matches on
 * whichever keyword shows up first in `productType`, then falls back to tags.
 * `jewelry` is checked before `accessories` since a watch/necklace/ring would
 * otherwise match accessories' own `jewelry`/`watch` keywords first.
 */
export function suggestCategory(productType?: string | null, tags?: string[] | null): string | undefined {
  const haystack = [productType ?? '', ...(tags ?? [])].join(' ').toLowerCase();
  if (!haystack.trim()) return undefined;
  const KEYWORDS: [string, string[]][] = [
    ['fragrance', ['fragrance', 'perfume', 'eau de', 'cologne']],
    ['footwear', ['shoe', 'sneaker', 'boot', 'sandal', 'footwear']],
    ['apparel', ['shirt', 'dress', 'jacket', 'pant', 'apparel', 'clothing', 'hoodie']],
    ['furniture', ['chair', 'table', 'sofa', 'furniture', 'shelf', 'desk']],
    ['beauty', ['skincare', 'serum', 'cream', 'lotion', 'cosmetic', 'makeup', 'beauty']],
    ['electronics', ['electronic', 'headphone', 'speaker', 'charger', 'device', 'gadget']],
    ['jewelry', ['jewelry', 'jewellery', 'necklace', 'bracelet', 'earring', 'ring']],
    ['accessories', ['bag', 'handbag', 'wallet', 'watch', 'accessory', 'accessories']],
    ['beverage', ['drink', 'beverage', 'soda', 'juice', 'coffee', 'tea']],
    ['food', ['food', 'snack', 'grocery', 'sauce', 'spice', 'pantry']],
  ];
  for (const [key, words] of KEYWORDS) {
    if (words.some((w) => haystack.includes(w))) return key;
  }
  return undefined;
}

/**
 * The category the library/filter logic should treat a product as — its own
 * stored `category` when that's a real key (a stale/renamed key falls
 * through rather than filtering the product into a dead bucket), else the
 * same suggestion `ProductPage` already offers as a default. One function so
 * the library grid and the product page never disagree about what category
 * a product "is" when nothing has been explicitly saved yet.
 */
export function effectiveCategory(product: {
  category?: string | null;
  productType?: string | null;
  tags?: string[] | null;
}): string | null {
  if (product.category && BY_KEY.has(product.category)) return product.category;
  return suggestCategory(product.productType, product.tags) ?? null;
}
