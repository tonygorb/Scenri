import { useMemo, useRef, useState } from 'react';
import { productSearchText } from '../displayName.js';
import { useNavigate } from 'react-router';
import { Dialog, DropdownMenu } from '@radix-ui/themes';
import { CaretDown, Plus, X } from '@phosphor-icons/react';
import { useBrand } from '../app/BrandLayout.js';
import { useAppData } from '../app/AppShell.js';
import { useApplyProduct } from '../app/useApplyProduct.js';
import { productPath } from '../routes.js';
import { ProductCard, ProductCardSkeleton } from '../layout/ProductCard.js';
import { DemoProductCard } from '../layout/DemoProductCard.js';
import { ProductsPanel, type ProductsPanelHandle } from '../AssetPanel.js';
import { PRODUCT_CATEGORIES, categoryLabel, effectiveCategory } from '../productCategories.js';
import { DensityControl, densitySize, densityWallStyle } from '../layout/DensityControl.js';
import { DENSITY_DEFAULT, normalizeDensity, type DensityCols } from '../layout/masonry.js';
import { LibraryToolbar } from '../layout/library/LibraryToolbar.js';
import { LibrarySearch } from '../layout/library/LibrarySearch.js';
import { FacetFilter } from '../layout/library/FacetFilter.js';
import { LibraryEmpty, LibraryZero } from '../layout/library/LibraryEmpty.js';
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
  const { brand, products, loaded, refresh } = useBrand();
  const { demoProducts } = useAppData();
  const navigate = useNavigate();
  const applyProduct = useApplyProduct();
  const { q, setQ, facets, setFacet, clearSearch, clear } = useLibraryQuery(['category']);
  const category = facets.category;
  const [addOpen, setAddOpen] = useState(false);
  const [addInitial, setAddInitial] = useState<'upload' | 'import'>('upload');
  const panelRef = useRef<ProductsPanelHandle>(null);
  const [tile, setTile] = useLocalPref(PREF.wallDensity, DENSITY_DEFAULT);
  const density = normalizeDensity(tile);
  const setDensity = (cols: DensityCols) => setTile(cols);
  const wallStyle = densityWallStyle(density);
  const densityAttr = densitySize(density);

  const withCategory = useMemo(() => products.map((p) => ({ product: p, category: effectiveCategory(p) })), [products]);

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

  const { visible, remaining, showMore } = useLibraryPage(filtered, `${category ?? ''}|${q}`);

  const facetGroup = {
    key: 'category',
    label: 'Category',
    everyLabel: 'Every product',
    everyCount: products.length,
    selected: category,
    onSelect: (v: string | null) => setFacet('category', v),
    options: presentCategories.map((c) => ({
      value: c.key,
      label: c.label,
      count: categoryCounts.get(c.key) ?? 0,
    })),
  };

  const openAdd = (which: 'upload' | 'import') => {
    setAddInitial(which);
    setAddOpen(true);
  };

  const addMenu = (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button type="button" className="sc-btn sc-btn-primary">
          <Plus size={12} /> Add product <CaretDown size={11} weight="bold" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Item onSelect={() => openAdd('upload')}>Upload a product</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => openAdd('import')}>Import from your store</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );

  const hasProducts = loaded && products.length > 0;

  return (
    <ScrollPane>
      <main className="sc-looks sc-products" id="main">
        <Dialog.Root open={addOpen} onOpenChange={setAddOpen}>
          <Dialog.Content
            maxWidth="560px"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              panelRef.current?.focusInitial(addInitial);
            }}
          >
            <Dialog.Close>
              <button type="button" className="sc-set-close sc-dlg-close" aria-label="Close">
                <X size={16} />
              </button>
            </Dialog.Close>
            <Dialog.Title>Products: {brand.json?.meta?.name}</Dialog.Title>
            <ProductsPanel ref={panelRef} brand={brand} onChanged={() => void refresh()} />
          </Dialog.Content>
        </Dialog.Root>

        {hasProducts ? (
          <LibraryToolbar
            title="Products"
            filters={<FacetFilter mode={mode} group={facetGroup} />}
            density={<DensityControl value={density} onChange={setDensity} />}
            search={
              products.length >= SEARCH_MIN && (
                <LibrarySearch value={q} onChange={setQ} noun="products" total={products.length} />
              )
            }
            action={addMenu}
          />
        ) : (
          <h1 className="sc-vh">Products</h1>
        )}

        {!loaded && (
          <div className="sc-masonry" data-density data-density-size={densityAttr} style={wallStyle} aria-hidden>
            <ProductCardSkeleton size="grid" count={8} />
          </div>
        )}

        {loaded && products.length === 0 && (
          <>
            <LibraryEmpty
              shape="cold"
              title={
                <>
                  Your first <em>product</em>
                </>
              }
              body="Upload a packshot or import your store catalog — every campaign starts from one."
              action={addMenu}
            />
            {demoProducts.length > 0 && (
              <div className="sc-products-starter">
                <div className="sc-eyebrow">Or start from our Scenri library</div>
                <div className="sc-masonry">
                  {demoProducts.map((p) => (
                    <DemoProductCard
                      key={p.id}
                      product={p}
                      variant="use"
                      onUse={applyProduct}
                      onOpen={(id) => navigate(productPath(brand, id))}
                      size="grid"
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {loaded && products.length > 0 && visible.length === 0 && (
          <LibraryZero
            noun="products"
            q={q}
            facet={category ? categoryLabel(category) : null}
            onClearSearch={clearSearch}
            onClearAll={clear}
          />
        )}

        {loaded && visible.length > 0 && (
          <div className="sc-masonry" data-wall data-density data-density-size={densityAttr} style={wallStyle}>
            {visible.map((p) => (
              <ProductCard key={p.id} product={p} variant="use" size="grid" onOpen={openProduct} onUse={applyProduct} />
            ))}
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
