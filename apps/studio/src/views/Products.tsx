import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Dialog, TextField } from '@radix-ui/themes';
import { MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { useBrand } from '../app/BrandLayout.js';
import { useApplyProduct } from '../app/useApplyProduct.js';
import { productPath } from '../routes.js';
import { ProductCard, ProductCardSkeleton } from '../layout/ProductCard.js';
import { ProductsPanel } from '../AssetPanel.js';
import { PRODUCT_CATEGORIES } from '../productCategories.js';

/** Past this many, the search box earns its place. Mirrors ProductsPanel's own threshold. */
const SEARCH_THRESHOLD = 12;

/**
 * The product library, browsable: a visual asset library rather than a
 * settings list, because these are the objects every campaign is actually
 * about. Flat, not collection-sectioned like Looks — a single brand's own
 * products don't need Studio/Social-style grouping, same reasoning as
 * PresentersView.
 */
export function ProductsView() {
  const { brand, products, loaded, refresh } = useBrand();
  const navigate = useNavigate();
  const applyProduct = useApplyProduct();
  const [category, setCategory] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const present = useMemo(() => {
    const keys = new Set(products.map((p) => p.category).filter((c): c is string => !!c));
    return PRODUCT_CATEGORIES.filter((c) => keys.has(c.key));
  }, [products]);

  // Category tabs only earn their place once they'd meaningfully split the
  // catalog. A stray "Accessories 1" next to "Every product 576" isn't a
  // filter, it's noise — hide the row until coverage is real.
  const categorized = useMemo(() => products.filter((p) => !!p.category).length, [products]);
  const showCategories = present.length >= 2 && categorized / Math.max(products.length, 1) >= 0.2;

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      products.filter(
        (p) => (!category || p.category === category) && (!needle || (p.name ?? '').toLowerCase().includes(needle)),
      ),
    [products, category, needle],
  );

  const openProduct = (id: string) => navigate(productPath(brand, id));

  return (
    <div className="sc-home">
      <main className="sc-looks sc-products" id="main">
        <div className="sc-filterbar">
          <span className="sc-sec-title" style={{ flexShrink: 0 }}>
            Products
          </span>

          {showCategories && (
            <div className="sc-verticals" role="tablist" aria-label="Categories">
              <button
                type="button"
                role="tab"
                aria-selected={!category}
                data-on={!category ? '' : undefined}
                onClick={() => setCategory(null)}
              >
                Every product <span className="sc-vcount">{products.length}</span>
              </button>
              {present.map((c) => (
                <button
                  type="button"
                  key={c.key}
                  role="tab"
                  aria-selected={category === c.key}
                  data-on={category === c.key ? '' : undefined}
                  onClick={() => setCategory(c.key)}
                >
                  {c.label} <span className="sc-vcount">{products.filter((p) => p.category === c.key).length}</span>
                </button>
              ))}
            </div>
          )}

          <div className="sc-filterbar-actions">
            {products.length > SEARCH_THRESHOLD && (
              <TextField.Root
                size="2"
                style={{ width: 220 }}
                placeholder={`Search ${products.length} products`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              >
                <TextField.Slot>
                  <MagnifyingGlass size={14} />
                </TextField.Slot>
              </TextField.Root>
            )}

            <Dialog.Root open={addOpen} onOpenChange={setAddOpen}>
              <Dialog.Trigger>
                <button type="button" className="sc-sec-more">
                  <Plus size={12} /> Add product
                </button>
              </Dialog.Trigger>
              <Dialog.Content maxWidth="560px">
                <Dialog.Close>
                  <button type="button" className="sc-set-close sc-dlg-close" aria-label="Close">
                    <X size={16} />
                  </button>
                </Dialog.Close>
                <Dialog.Title>Products: {brand.json?.meta?.name}</Dialog.Title>
                <ProductsPanel brand={brand} onChanged={() => void refresh()} />
              </Dialog.Content>
            </Dialog.Root>
          </div>
        </div>

        {!loaded && (
          <div className="sc-masonry" aria-hidden>
            <ProductCardSkeleton size="grid" count={8} />
          </div>
        )}

        {loaded && products.length === 0 && (
          <div className="sc-canvas-empty">
            <h3>
              Your first <em>product</em>
            </h3>
            <p>Upload a packshot or import a store catalog — this is what every campaign starts from.</p>
            <div className="sc-lookpage-acts">
              <button type="button" className="sc-btn sc-btn-primary" onClick={() => setAddOpen(true)}>
                <Plus size={12} /> Add product
              </button>
            </div>
          </div>
        )}

        {loaded && products.length > 0 && shown.length === 0 && (
          <p className="sc-looks-empty">Nothing matches{needle ? ` "${q.trim()}"` : ' that category'}.</p>
        )}

        {loaded && shown.length > 0 && (
          <div className="sc-masonry">
            {shown.map((p) => (
              <ProductCard key={p.id} product={p} variant="use" size="grid" onOpen={openProduct} onUse={applyProduct} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
