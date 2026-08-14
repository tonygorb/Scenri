import type { DemoProduct, Presenter, Scene, ShowcaseEntry } from './api.js';
import { productLabel, sceneLabel } from './displayName.js';

/**
 * The catalog objects a use case points at, and the credit props its card
 * shows for them.
 *
 * One resolution shared by Home's wall and Create's first-run shelf. It lived
 * inside Home, which is why the same tiles arrived on Create with no credits:
 * the card takes the names and thumbs as props, so a caller that does not
 * resolve them renders a picture with nothing under it.
 */
export interface Catalogs {
  demoProducts: DemoProduct[];
  presenters: Presenter[];
  scenes: Scene[];
}

export function resolveRecipe(entry: ShowcaseEntry, { demoProducts, presenters, scenes }: Catalogs) {
  const tokens = entry.brief?.tokens ?? [];
  const productId = tokens.find((t: any) => t?.t === 'product')?.id as string | undefined;
  const presenterId = tokens.find((t: any) => t?.t === 'character')?.id as string | undefined;
  const sceneId = tokens.find((t: any) => t?.t === 'template')?.id as string | undefined;
  return {
    product: productId ? demoProducts.find((p) => p.id === productId) : undefined,
    presenter: presenterId ? presenters.find((p) => p.id === presenterId) : undefined,
    scene: sceneId ? scenes.find((s) => s.id === sceneId) : undefined,
  };
}

/** The credit props `ShowcaseCard` takes, ready to spread. */
export function recipeProps(entry: ShowcaseEntry, catalogs: Catalogs) {
  const { product, presenter, scene } = resolveRecipe(entry, catalogs);
  return {
    // Three names share one ellipsis-capped line, so each gets its tightest
    // form. The full label lives in the credit tooltip.
    productName: product ? productLabel(product, 'chip') : null,
    productPreviewUrl: product?.previewUrl ?? null,
    productId: product?.id ?? null,
    presenterName: presenter?.name ?? null,
    // .sc-showcase-chip img is a circle, which the square portrait fills cleanly.
    presenterPreviewUrl: presenter?.avatarUrl ?? presenter?.previewUrl ?? null,
    presenterId: presenter?.id ?? null,
    sceneName: scene ? sceneLabel(scene, 'chip') : null,
    scenePreviewUrl: scene?.previewUrl ?? null,
    sceneId: scene?.id ?? null,
  };
}
