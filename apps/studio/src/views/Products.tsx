import { useMemo, useRef, useState } from 'react';
import { productSearchText } from '../displayName.js';
import { useNavigate } from 'react-router';
import { Plus } from '@phosphor-icons/react';
import { useBrand } from '../app/BrandLayout.js';
import { useCreateAsset } from '../create/AssetCreateHost.js';
import { useAppData } from '../app/AppShell.js';
import { useApplyProduct } from '../app/useApplyProduct.js';
import { productPath } from '../routes.js';
import { ProductCard, ProductCardSkeleton } from '../layout/ProductCard.js';
import { DemoProductCard } from '../layout/DemoProductCard.js';
import { PRODUCT_CATEGORIES, categoryLabel, effectiveCategory } from '../productCategories.js';
import { DensityControl, densitySize, densityWallStyle } from '../layout/DensityControl.js';
import { DENSITY_DEFAULT, normalizeDensity, type DensityCols } from '../layout/masonry.js';
import { LibraryToolbar } from '../layout/library/LibraryToolbar.js';
import { LibrarySearch } from '../layout/library/LibrarySearch.js';
import { FacetFilter } from '../layout/library/FacetFilter.js';
import { LibraryEmpty, LibraryZero } from '../layout/library/LibraryEmpty.js';
import { StarterDivider } from '../layout/library/StarterDivider.js';
import { useLibraryQuery } from '../layout/library/useLibraryQuery.js';
import { useLibraryPage } from '../layout/library/useLibraryPage.js';
import { matchesQuery, facetMode } from '../layout/library/libraryRules.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { PREF, useLocalPref } from '../prefs.js';

/** Below this, a search box has nothing worth narrowing — the whole set is one screenful. */
const SEARCH_MIN = 8;

/**
 * The product library, browsable: a visual asset library rather than a
 * settings list, because these are the objects every campaign is actually
 * about. Flat, not collection-sectioned like Scenes — a single brand's own
 * products don't need Studio/Social-style grouping, same reasoning as
 * PresentersView. Built on the shared Creative Library shell
 * (docs/product/patterns/creative-library.md). Category tabs use
 * `effectiveCategory` (stored key, else a guess from productType/tags), so a
 * catalog import with sparse category data still gets a real, usable filter.
 */
export function ProductsView() {
  const { brand, products, loaded } = useBrand();
  const { demoProducts } = useAppData();
  /**
   * Before you have products of your own, the wall on this page is the Scenri
   * library, so the filter row filters that instead of filtering nothing.
   *
   * It used to be hidden here entirely, which left the one page in the set
   * opening differently from Presenters and Scenes, and left 44 products with
   * no way to narrow them.
   */
  const cold = loaded && products.length === 0;
  const navigate = useNavigate();
  const applyProduct = useApplyProduct();
  const createAsset = useCreateAsset();
  const { q, setQ, facets, setFacet, clearSearch, clear } = useLibraryQuery(['category']);
  const category = facets.category;
  const [tile, setTile] = useLocalPref(PREF.wallDensity, DENSITY_DEFAULT);
  const density = normalizeDensity(tile);
  const setDensity = (cols: DensityCols) => setTile(cols);
  const wallStyle = densityWallStyle(density);
  const densityAttr = densitySize(density);

  // In the cold state the filter row answers for the library, so everything
  // below reads from whichever set is actually on screen.
  const withCategory = useMemo(
    () =>
      cold
        ? demoProducts.map((p) => ({ product: p as any, category: p.category }))
        : products.map((p) => ({ product: p as any, category: effectiveCategory(p) })),
    [cold, demoProducts, products],
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { category: c } of withCategory) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    return counts;
  }, [withCategory]);

  const presentCategories = useMemo(
    () => PRODUCT_CATEGORIES.filter((c) => categoryCounts.has(c.key)),
    [categoryCounts],
  );
  const mode = facetMode(presentCategories.length);

  const openProduct = (id: string) => navigate(productPath(brand, id));

  const filtered = useMemo(
    () =>
      withCategory
        .filter(({ category: c }) => !category || c === category)
        .filter(({ product: p, category: c }) =>
          matchesQuery([productSearchText(p), categoryLabel(c)].filter(Boolean).join(' '), q),
        )
        .map(({ product }) => product),
    [withCategory, category, q],
  );

  const { visible, remaining, showMore } = useLibraryPage(filtered, `${cold ? 'lib' : ''}${category ?? ''}|${q}`);

  const facetGroup = {
    key: 'category',
    label: 'Category',
    everyLabel: 'Every product',
    everyCount: withCategory.length,
    selected: category,
    onSelect: (v: string | null) => setFacet('category', v),
    options: presentCategories.map((c) => ({
      value: c.key,
      label: c.label,
      count: categoryCounts.get(c.key) ?? 0,
    })),
  };

  /* One button, one flow. The dropdown that used to sit here offered "Upload a
     product" and "Import from your store" as two choices, and both opened the
     same dialog with a different field focused — a menu describing flows that
     did not exist. Importing is still there, inside, where it belongs. */
  const addMenu = (
    <button type="button" className="sc-btn sc-btn-primary" onClick={() => createAsset('product')}>
      <Plus size={12} /> Add product
    </button>
  );

  /** Nothing of your own yet: the page leads with its offer, filter or not. */
  const heroMode = cold;

  const toolbar = (
    <LibraryToolbar
      title="Products"
      filters={<FacetFilter mode={mode} group={facetGroup} />}
      density={<DensityControl value={density} onChange={setDensity} />}
      search={
        withCategory.length >= SEARCH_MIN && (
          <LibrarySearch value={q} onChange={setQ} noun="products" total={withCategory.length} />
        )
      }
      // One CTA on the page: the offer owns it while it is showing.
      action={heroMode ? undefined : addMenu}
    />
  );

  return (
    <ScrollPane>
      <main className="sc-looks sc-products" id="main" data-hero={heroMode || undefined}>
        {heroMode ? <h1 className="sc-vh">Products</h1> : toolbar}

        {!loaded && (
          <div className="sc-masonry" data-density data-density-size={densityAttr} style={wallStyle} aria-hidden>
            <ProductCardSkeleton size="grid" count={8} />
          </div>
        )}

        {heroMode && (
          <LibraryEmpty
            shape="cold"
            title={
              <>
                Bring in a <em>product</em>
              </>
            }
            body="Upload a few clean shots, or import your store, and it stays exact in every image you make."
            action={addMenu}
          />
        )}

        {!heroMode && visible.length === 0 && (
          <LibraryZero
            noun="products"
            q={q}
            facet={category ? categoryLabel(category) : null}
            onClearSearch={clearSearch}
            onClearAll={clear}
          />
        )}

        {loaded && visible.length > 0 && (
          // Cold, the wall is the Scenri library and carries the filter row
          // with it, the same shape Presenters and Scenes open with.
          <div className={heroMode ? 'sc-starter' : undefined}>
            {heroMode && <StarterDivider label="Or borrow one of ours" />}
            <div className="sc-masonry" data-wall data-density data-density-size={densityAttr} style={wallStyle}>
              {visible.map((p) =>
                cold ? (
                  <DemoProductCard
                    key={p.id}
                    product={p}
                    variant="use"
                    size="grid"
                    onUse={applyProduct}
                    onOpen={openProduct}
                  />
                ) : (
                  <ProductCard
                    key={p.id}
                    product={p}
                    variant="use"
                    size="grid"
                    onOpen={openProduct}
                    onUse={applyProduct}
                  />
                ),
              )}
            </div>
          </div>
        )}

        {remaining > 0 && (
          <div className="sc-lib-more">
            <button type="button" className="sc-btn sc-btn-ghost" onClick={showMore}>
              Show {Math.min(remaining, 60)} more
            </button>
          </div>
        )}
      </main>
    </ScrollPane>
  );
}
