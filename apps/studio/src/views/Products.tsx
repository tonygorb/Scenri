import { useCallback, useMemo } from 'react';
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
 * (layout/library/). Category tabs use
 * `effectiveCategory` (stored key, else a guess from productType/tags), so a
 * catalog import with sparse category data still gets a real, usable filter.
 */
export function ProductsView() {
  const { brand, products, productsLoaded } = useBrand();
  const { demoProducts } = useAppData();
  /**
   * Whether this brand has products of its own at all, before any filter.
   *
   * The wall below is always the Scenri library. It used to be *either* your
   * products or ours — own one and all 44 vanished from the page, which made
   * the default catalog behave like an onboarding fallback rather than the
   * complementary library it is. Presenters and Scenes have always shown both
   * halves; this is that same shape, and the reason a brand can still reach
   * for a Scenri product to test a scene or rebuild a homepage example after
   * importing a catalog of its own.
   *
   * Gated on the *product library's* own loaded flag, not the workspace's: a
   * brand with a full catalog used to flash the first-run offer on every cold
   * load, because the shots had arrived and the products had not.
   */
  const cold = productsLoaded && products.length === 0;
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

  /** Yours, for the section above the seam. */
  const mine = useMemo(
    () => products.map((p) => ({ product: p as any, category: effectiveCategory(p), own: true })),
    [products],
  );
  /** Ours, for the wall below it. Always present, at every catalog size. */
  const theirs = useMemo(
    () => demoProducts.map((p) => ({ product: p as any, category: p.category, own: false })),
    [demoProducts],
  );
  // The filter row answers for the whole page, both halves, so a count on a
  // tab is never a number for only one of them.
  const withCategory = useMemo(() => [...mine, ...theirs], [mine, theirs]);

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

  /** The facet and the search, applied to either half by the same rule. */
  const narrow = useCallback(
    (rows: { product: any; category: string | null | undefined }[]) =>
      rows
        .filter(({ category: c }) => !category || c === category)
        .filter(({ product: p, category: c }) =>
          matchesQuery([productSearchText(p), categoryLabel(c)].filter(Boolean).join(' '), q),
        )
        .map(({ product }) => product),
    [category, q],
  );

  const mineFiltered = useMemo(() => narrow(mine), [narrow, mine]);
  const theirsFiltered = useMemo(() => narrow(theirs), [narrow, theirs]);

  /**
   * Only your half pages. A brand's own catalog runs to hundreds after a store
   * import; Scenri's is a fixed forty-four, and hiding a third of a small,
   * unchanging library behind a button is chrome for nothing.
   */
  const { visible: mineVisible, remaining, showMore } = useLibraryPage(mineFiltered, `${category ?? ''}|${q}`);

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

  /**
   * Nothing of your own yet: the page leads with its offer, filter or not.
   *
   * Ownership is the only input — never the filtered count. Narrowing to a
   * category your one product is not in used to read as losing the page,
   * chrome and all, and snapping back to the first-run offer.
   *
   * It gates the offer alone. The filter row is gated on the wall it filters
   * (see below), so the cold state keeps its search and its categories over
   * the 44 products of ours sitting underneath the offer.
   */
  const heroMode = cold;
  const showMine = products.length > 0;

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
        {!heroMode && toolbar}

        {!productsLoaded && (
          <div className="sc-masonry" data-density data-density-size={densityAttr} style={wallStyle} aria-hidden>
            <ProductCardSkeleton size="grid" count={8} />
          </div>
        )}

        {showMine && mineVisible.length > 0 && (
          <section className="sc-owned">
            <div className="sc-sec-head">
              <h2 className="sc-sec-title">Your products</h2>
            </div>
            <div className="sc-masonry" data-wall data-density data-density-size={densityAttr} style={wallStyle}>
              {mineVisible.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  variant="use"
                  size="grid"
                  onOpen={openProduct}
                  onUse={applyProduct}
                />
              ))}
            </div>
            {remaining > 0 && (
              <div className="sc-lib-more">
                <button type="button" className="sc-btn sc-btn-ghost" onClick={showMore}>
                  Show {Math.min(remaining, 60)} more
                </button>
              </div>
            )}
          </section>
        )}

        {/* The cold state, the same one Presenters and Scenes show: the offer,
            centred, with the library underneath so the page is never an empty
            room. */}
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

        {/* A heading only where it separates two things. Filter your own half
            away and the page is simply a wall of ours, which needs no label. */}
        {showMine && mineVisible.length > 0 && theirsFiltered.length > 0 && (
          <div className="sc-sec-head sc-owned-divider">
            <h2 className="sc-sec-title">Scenri products</h2>
          </div>
        )}

        {/* The seam, and the row that belongs to the wall under it. Gated on
            the unfiltered library, not on what survives the filter: a search
            that finds nothing must not take the control you searched with. */}
        {heroMode && theirs.length > 0 && (
          <>
            <StarterDivider label="Or borrow one of ours" />
            {toolbar}
          </>
        )}

        {theirsFiltered.length > 0 && (
          <div className="sc-masonry" data-wall data-density data-density-size={densityAttr} style={wallStyle}>
            {theirsFiltered.map((p) => (
              <DemoProductCard
                key={p.id}
                product={p}
                variant="use"
                size="grid"
                onUse={applyProduct}
                onOpen={openProduct}
              />
            ))}
          </div>
        )}

        {productsLoaded && mineFiltered.length === 0 && theirsFiltered.length === 0 && (
          <LibraryZero
            noun="products"
            q={q}
            facet={category ? categoryLabel(category) : null}
            onClearSearch={clearSearch}
            onClearAll={clear}
          />
        )}
      </main>
    </ScrollPane>
  );
}
