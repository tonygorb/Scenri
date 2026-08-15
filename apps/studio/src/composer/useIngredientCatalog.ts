import { useMemo } from 'react';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { customPresentersOf, customScenesOf, withCustomFirst } from '../brandAssets.js';
import type { IngredientCatalog } from './ingredientOptions.js';

/**
 * The one answer to "what can this brief reach", for every surface that offers
 * a choice.
 *
 * It used to be three answers. The rail, the attach panel and the caret menu
 * each rebuilt this list themselves, and each wrote the products fallback a
 * slightly different way, so the three surfaces could disagree about what the
 * brand even owned. The custom-scene/custom-presenter merge was written out
 * twice more on top of that, once in Create for the rail and once in Composer
 * for everything else.
 *
 * `productCategory` is the only per-caller input: it feeds the "suited to this
 * product" hint in `buildCandidates`, and a surface with no active product
 * simply passes nothing.
 */
export function useIngredientCatalog(productCategory?: string | null): IngredientCatalog {
  const { brand, products } = useBrand();
  const { scenes: catalogScenes, presenters: catalogPresenters, demoProducts } = useAppData();

  const scenes = useMemo(() => withCustomFirst(customScenesOf(brand), catalogScenes), [brand, catalogScenes]);
  const presenters = useMemo(
    () => withCustomFirst(customPresentersOf(brand), catalogPresenters),
    [brand, catalogPresenters],
  );
  /**
   * The roster from before the presenter catalog existed, and only that.
   *
   * `characters` holds two different things: legacy cast entries, and the
   * presenters this brand built for itself (`origin: 'custom'`). The custom
   * ones already arrive above, merged ahead of the catalog by
   * `withCustomFirst` — handing them over a second time here rendered the same
   * person twice in every picker, once tagged `catalog` and once `brand`.
   */
  const cast = useMemo(() => ((brand?.json?.characters ?? []) as any[]).filter((c) => c?.origin !== 'custom'), [brand]);
  const brandProducts = useMemo(() => (brand?.json?.products ?? []) as any[], [brand]);

  return useMemo(
    () => ({
      libraryProducts: products,
      brandProducts,
      demoProducts,
      presenters,
      cast,
      scenes,
      productCategory: productCategory ?? null,
    }),
    [products, brandProducts, demoProducts, presenters, cast, scenes, productCategory],
  );
}
