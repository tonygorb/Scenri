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
    key: "fragrance",
    label: "Fragrance",
    angles: [
      { key: "front", label: "Front" },
      { key: "three-quarter", label: "Three-quarter" },
      { key: "side", label: "Side" },
      { key: "rear-label", label: "Rear / label" },
      { key: "cap-detail", label: "Cap detail" },
      { key: "material-closeup", label: "Material close-up" },
    ],
  },
  {
    key: "footwear",
    label: "Footwear",
    angles: [
      { key: "lateral-side", label: "Lateral side" },
      { key: "medial-side", label: "Medial side" },
      { key: "top", label: "Top" },
      { key: "rear", label: "Rear" },
      { key: "three-quarter", label: "Three-quarter" },
      { key: "sole-detail", label: "Sole / detail" },
    ],
  },
  {
    key: "apparel",
    label: "Apparel",
    angles: [
      { key: "front", label: "Front" },
      { key: "back", label: "Back" },
      { key: "detail-fabric", label: "Detail / fabric" },
      { key: "on-form", label: "On a form or flat lay" },
    ],
  },
  {
    key: "furniture",
    label: "Furniture",
    angles: [
      { key: "front", label: "Front" },
      { key: "three-quarter", label: "Three-quarter" },
      { key: "side", label: "Side" },
      { key: "detail-material", label: "Detail / material" },
      { key: "in-scale", label: "In a room, for scale" },
    ],
  },
  {
    key: "beauty",
    label: "Beauty / skincare",
    angles: [
      { key: "front", label: "Front" },
      { key: "three-quarter", label: "Three-quarter" },
      { key: "applicator-detail", label: "Cap / applicator detail" },
      { key: "label", label: "Label" },
    ],
  },
  {
    key: "electronics",
    label: "Electronics",
    angles: [
      { key: "front", label: "Front" },
      { key: "three-quarter", label: "Three-quarter" },
      { key: "side", label: "Side" },
      { key: "ports-detail", label: "Ports / detail" },
    ],
  },
  {
    key: "jewelry",
    label: "Jewelry",
    angles: [
      { key: "front", label: "Front" },
      { key: "three-quarter", label: "Three-quarter" },
      { key: "clasp-detail", label: "Clasp / setting detail" },
      { key: "worn-scale", label: "Worn, for scale" },
    ],
  },
  {
    key: "accessories",
    label: "Accessories",
    angles: [
      { key: "front", label: "Front" },
      { key: "three-quarter", label: "Three-quarter" },
      { key: "detail", label: "Detail" },
      { key: "worn-scale", label: "Worn, for scale" },
    ],
  },
  {
    key: "beverage",
    label: "Beverage",
    angles: [
      { key: "front", label: "Front" },
      { key: "three-quarter", label: "Three-quarter" },
      { key: "label", label: "Label" },
      { key: "cap-closure", label: "Cap / closure detail" },
    ],
  },
  {
    key: "food",
    label: "Food",
    angles: [
      { key: "front", label: "Front" },
      { key: "three-quarter", label: "Three-quarter" },
      { key: "ingredient-detail", label: "Ingredient / texture detail" },
      { key: "packaging-label", label: "Packaging / label" },
    ],
  },
  {
    key: "other",
    label: "Other",
    angles: [
      { key: "front", label: "Front" },
      { key: "three-quarter", label: "Three-quarter" },
      { key: "side", label: "Side" },
      { key: "detail", label: "Detail" },
    ],
  },
];

const BY_KEY = new Map(PRODUCT_CATEGORIES.map((c) => [c.key, c]));

export const OTHER_CATEGORY: ProductCategory = BY_KEY.get("other")!;

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
export function suggestCategory(
  productType?: string | null,
  tags?: string[] | null,
): string | undefined {
  const haystack = [productType ?? "", ...(tags ?? [])].join(" ").toLowerCase();
  if (!haystack.trim()) return undefined;
  const KEYWORDS: [string, string[]][] = [
    ["fragrance", ["fragrance", "perfume", "eau de", "cologne"]],
    ["footwear", ["shoe", "sneaker", "boot", "sandal", "footwear"]],
    [
      "apparel",
      ["shirt", "dress", "jacket", "pant", "apparel", "clothing", "hoodie"],
    ],
    ["furniture", ["chair", "table", "sofa", "furniture", "shelf", "desk"]],
    [
      "beauty",
      ["skincare", "serum", "cream", "lotion", "cosmetic", "makeup", "beauty"],
    ],
    [
      "electronics",
      ["electronic", "headphone", "speaker", "charger", "device", "gadget"],
    ],
    [
      "jewelry",
      ["jewelry", "jewellery", "necklace", "bracelet", "earring", "ring"],
    ],
    [
      "accessories",
      ["bag", "handbag", "wallet", "watch", "accessory", "accessories"],
    ],
    ["beverage", ["drink", "beverage", "soda", "juice", "coffee", "tea"]],
    ["food", ["food", "snack", "grocery", "sauce", "spice", "pantry"]],
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
