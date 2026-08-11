import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { Core } from '@scenri/core';

/**
 * A demo product is a fictional-but-premium product with a full multi-angle
 * reference set (see PRODUCT_ANGLES_BY_CATEGORY below), curated so a
 * showcase recipe — or a real user with no products of their own yet — can
 * attach a visually credible product without any upload. Resolves into a
 * brief exactly the way a Presenter resolves into a `character` token — a
 * read-through catalog, never copied into a real brand's own `products[]`.
 */
export interface DemoProduct {
  id: string;
  name: string;
  /** Lowercase key from apps/studio/src/productCategories.ts's PRODUCT_CATEGORIES. */
  category: string;
  description: string;
  width: number;
  height: number;
  /** Fictional brand/house name, distinct from the (sometimes brand-inclusive) `name`. */
  brand?: string;
  /** Physical format within the category, e.g. "rollerball" vs "spray bottle". */
  subcategory?: string;
  materials?: string;
  primaryColors?: string;
  /** Scene collection/vertical tags this product photographs well against. */
  suitableScenes?: string[];
  /** Things the model should never do to this product (extra guardrail text). */
  negativeConstraints?: string;
  /** Extra fidelity directive appended alongside the standard "preserve faithfully" line. */
  preservationNotes?: string;
}

/**
 * Category-specific multi-angle reference plan, mirroring
 * apps/studio/src/productCategories.ts's `angles` field exactly (kept as a
 * self-contained constant here rather than imported cross-package, same
 * precedent as presenters.ts's own PRESENTER_ANGLES). Every demo product
 * gets one photo per angle key in its category's list.
 */
export const PRODUCT_ANGLES_BY_CATEGORY: Record<string, string[]> = {
  fragrance: ['front', 'three-quarter', 'side', 'rear-label', 'cap-detail', 'material-closeup'],
  footwear: ['lateral-side', 'medial-side', 'top', 'rear', 'three-quarter', 'sole-detail'],
  apparel: ['front', 'back', 'detail-fabric', 'on-form'],
  furniture: ['front', 'three-quarter', 'side', 'detail-material', 'in-scale'],
  beauty: ['front', 'three-quarter', 'applicator-detail', 'label'],
  electronics: ['front', 'three-quarter', 'side', 'back', 'ports-detail', 'screen-on'],
  jewelry: ['front', 'three-quarter', 'clasp-detail', 'worn-scale'],
  accessories: ['front', 'three-quarter', 'detail', 'worn-scale'],
  beverage: ['front', 'three-quarter', 'label', 'cap-closure'],
  food: ['front', 'three-quarter', 'ingredient-detail', 'packaging-label'],
  other: ['front', 'three-quarter', 'side', 'detail'],
};

/** The "slightly dimensional, not flat" angle used as the card/chip thumbnail — three-quarter where the category has one, else front. */
export function primaryAngleFor(category: string): string {
  const angles = PRODUCT_ANGLES_BY_CATEGORY[category] ?? PRODUCT_ANGLES_BY_CATEGORY.other;
  return angles.includes('three-quarter') ? 'three-quarter' : (angles[0] ?? 'front');
}

const ID = /^[a-z0-9-]+$/;

function isDemoProduct(x: any): x is DemoProduct {
  return (
    x &&
    typeof x.id === 'string' &&
    ID.test(x.id) &&
    typeof x.name === 'string' &&
    typeof x.category === 'string' &&
    x.category &&
    typeof x.description === 'string' &&
    Number.isFinite(x.width) &&
    Number.isFinite(x.height)
  );
}

/** Load demo product files; a bad file is skipped with a warning, never fatal. */
export function loadDemoProducts(dir = defaultDemoProductsDir()): { demoProducts: DemoProduct[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!dir || !existsSync(dir)) return { demoProducts: [], warnings: [`demo products dir not found: ${dir}`] };
  const demoProducts: DemoProduct[] = [];
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (isDemoProduct(parsed)) demoProducts.push(parsed);
      else warnings.push(`invalid demo product skipped: ${f}`);
    } catch {
      warnings.push(`unparseable demo product skipped: ${f}`);
    }
  }
  return { demoProducts, warnings };
}

export function demoProductResolver(demoProducts: DemoProduct[]): (id: string) => DemoProduct | undefined {
  const byId = new Map<string, DemoProduct>();
  for (const p of demoProducts) byId.set(p.id, p);
  return (id: string) => byId.get(id);
}

/** Every category actually in use, for the library filters. */
export function demoProductFacetsOf(demoProducts: DemoProduct[]): { categories: string[] } {
  const categories = new Set<string>();
  for (const p of demoProducts) categories.add(p.category);
  return { categories: [...categories].sort() };
}

export function demoProductRefPath(templatesRoot: string, id: string, angle: string): string {
  return join(templatesRoot, 'previews', 'demo-products', id, `${angle}.jpg`);
}

/**
 * Loads one curated demo product's full multi-angle reference set into the
 * image store, hashing each on first use — mirrors resolvePresenterImages
 * exactly. A read-through cache, not a write to any brand's data — nothing
 * here touches `products[]`.
 */
export async function resolveDemoProductImages(
  core: Core,
  templatesRoot: string,
  product: DemoProduct,
): Promise<{
  id: string;
  name: string;
  shots: { file: string; angle: string; locked: boolean }[];
  preservationNotes?: string;
  negativeConstraints?: string;
  materials?: string;
  primaryColors?: string;
} | null> {
  const angles = PRODUCT_ANGLES_BY_CATEGORY[product.category] ?? PRODUCT_ANGLES_BY_CATEGORY.other;
  const shots: { file: string; angle: string; locked: boolean }[] = [];
  for (const angle of angles) {
    const path = demoProductRefPath(templatesRoot, product.id, angle);
    if (!existsSync(path)) continue;
    const png = await sharp(readFileSync(path)).png().toBuffer();
    const hash = core.images.save(png);
    shots.push({ file: `asset:${hash}`, angle, locked: true });
  }
  if (!shots.length) return null;
  return {
    id: product.id,
    name: product.name,
    shots,
    ...(product.preservationNotes ? { preservationNotes: product.preservationNotes } : {}),
    ...(product.negativeConstraints ? { negativeConstraints: product.negativeConstraints } : {}),
    // Material and colour are identity, not decoration: they are what makes a
    // brushed steel case read as steel rather than plastic. They were being
    // dropped here, so the compiler never saw them.
    ...(product.materials ? { materials: product.materials } : {}),
    ...(product.primaryColors ? { primaryColors: product.primaryColors } : {}),
  };
}

/**
 * A brief's `product` tokens may name a curated demo product directly rather
 * than a real brand's own catalog entry. This resolves only the ones
 * actually referenced (never the whole catalog) and folds them into a
 * throwaway copy of the brand json for `compileBrief` to read — existing
 * `products[]` entries (the brand's own uploads) are left exactly as they
 * are and take priority, so nothing already generated changes meaning.
 */
export async function brandJsonWithResolvedDemoProducts(
  core: Core,
  templatesRoot: string,
  demoProducts: DemoProduct[],
  brandJson: any,
  tokens: { t: string; id?: string }[],
): Promise<any> {
  const existing: any[] = brandJson?.products ?? [];
  const neededIds = new Set(
    tokens.filter((t) => t.t === 'product' && typeof t.id === 'string').map((t) => t.id as string),
  );
  const missingIds = [...neededIds].filter((id) => !existing.some((p) => p.id === id));
  if (!missingIds.length) return brandJson;

  const extra: any[] = [];
  for (const id of missingIds) {
    const product = demoProducts.find((p) => p.id === id);
    if (!product) continue;
    const resolved = await resolveDemoProductImages(core, templatesRoot, product);
    if (resolved) extra.push(resolved);
  }
  return extra.length ? { ...brandJson, products: [...existing, ...extra] } : brandJson;
}

export function defaultDemoProductsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dev: monorepo root /templates/demo-products; published: bundled next to package
  for (const p of [
    join(here, '..', '..', '..', 'templates', 'demo-products'),
    join(here, '..', 'templates', 'demo-products'),
  ]) {
    if (existsSync(p)) return p;
  }
  return join(here, '..', '..', '..', 'templates', 'demo-products');
}
