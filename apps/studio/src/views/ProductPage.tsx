import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, assetUrl, addProductShot, deleteProduct, type DemoProduct, type Product } from '../api.js';
import { Confirm } from '../Confirm.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useMadeWith } from './useMadeWith.js';
import { useApplyProduct } from '../app/useApplyProduct.js';
import { useToasts } from '../toasts.js';
import { useTitleEntity } from '../useDocumentTitle.js';
import { productPath, productsPath, shotPath } from '../routes.js';
import { CategoryPicker } from '../layout/CategoryPicker.js';
import { DemoProductCard } from '../layout/DemoProductCard.js';
import { ProductCard } from '../layout/ProductCard.js';
import { ProductReferences, type ProductRef } from '../layout/ProductReferences.js';
import { ShotThumb, Slider } from '../layout/ReferenceGallery.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { categoryLabel, effectiveCategory } from '../productCategories.js';

/** Mirrors PRODUCT_REF_MAX in packages/cli/src/brief.ts — the number of product images a brief actually attaches. */
const PRODUCT_REF_MAX = 3;

type Editable = 'full' | 'fields' | 'none';

/** Brand/vendor only when the heading would have prefixed it — never "Kova Kova". */
function displayBrand(p: DemoProduct | Product): string | null {
  const anyP = p as DemoProduct & Product;
  const brand = (anyP.brand ?? anyP.vendor ?? '').trim();
  if (!brand) return null;
  if (p.name.toLowerCase().startsWith(brand.toLowerCase())) return null;
  return brand;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The opening sentence, or a clean truncation when the first one runs long. */
function firstSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const stop = text.slice(0, max + 1).search(/[.!?](\s|$)/);
  if (stop > 40) return text.slice(0, stop + 1);
  const cut = text.lastIndexOf(' ', max);
  return `${text.slice(0, cut > 40 ? cut : max).trimEnd()}\u2026`;
}

/**
 * The heading, editable in place.
 *
 * A textarea rather than a field: product names run long ("Wide mechanical
 * keyboard, tenkeyless, walnut"), the static heading wraps to a measure, and a
 * single-line input would cut the same name off mid-word the moment it became
 * editable. Grows to its content so the page never scrolls a heading sideways.
 */
function TitleField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => grow(ref.current), [value]);
  return (
    <textarea
      ref={ref}
      className="sc-lookpage-titleedit"
      rows={1}
      dir="auto"
      aria-label="Product name"
      value={value}
      onChange={(e) => {
        grow(e.currentTarget);
        onChange(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * One product — the record of what it actually looks like, and the place its
 * references get corrected.
 *
 * Same look-page as a presenter or a scene: identity, one action, then the
 * pictures. The pictures are the difference — one object from several sides,
 * swapped in a single frame, not a grid of equal looks.
 */
export function ProductPage() {
  const { productId = '' } = useParams();
  const { brand, products, refresh, refreshProducts } = useBrand();
  const { demoProducts, demoProductsLoaded } = useAppData();
  const navigate = useNavigate();
  const applyProduct = useApplyProduct();
  const { push } = useToasts();

  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const product = products.find((p) => p.id === productId);
  const demoProduct = useMemo(
    () => (product ? undefined : demoProducts.find((d) => d.id === productId)),
    [product, demoProducts, productId],
  );
  useTitleEntity((product ?? demoProduct)?.name);

  const [demoFrames, setDemoFrames] = useState<{ angle: string; url: string }[]>([]);
  useEffect(() => {
    if (!demoProduct) {
      setDemoFrames([]);
      return;
    }
    let alive = true;
    api
      .demoProductFrames(demoProduct.id)
      .then((r) => {
        if (alive) setDemoFrames(r.frames);
      })
      .catch(() => {
        if (alive) setDemoFrames([]);
      });
    return () => {
      alive = false;
    };
  }, [demoProduct?.id]);

  const [name, setName] = useState(product?.name ?? '');
  useEffect(() => {
    setName(product?.name ?? '');
  }, [product?.id]);

  /** Shots whose brief carried this product, newest first. */
  const made = useMadeWith(brand.id, [productId ?? '']);

  const isManual = (product?.origin ?? 'manual') === 'manual';

  const patch = (p: Partial<Pick<Product, 'name' | 'category' | 'variant' | 'material' | 'dimensions'>>) => {
    if (!product) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const write = isManual
        ? api.updateProduct(brand.id, product.id, p)
        : api.updateCatalogProduct(brand.id, product.id, p);
      void write.then(() => refreshProducts()).catch((e: any) => setErr(String(e.message ?? e)));
    }, 500);
  };

  const run = async (job: Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await job;
      await refreshProducts();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!product) return;
    setRemoving(true);
    setErr(null);
    try {
      if (product.origin === 'catalog' || product.id.startsWith('cat-')) {
        await api.deleteCatalogProduct(brand.id, product.id);
      } else {
        await deleteProduct(brand.id, product.id);
      }
      await refresh();
      navigate(productsPath(brand), { replace: true });
    } catch (e: any) {
      setErr(String(e.message ?? e));
      setRemoving(false);
    }
  };

  if (!product && !demoProduct && !demoProductsLoaded) {
    return (
      <ScrollPane>
        <main className="sc-lookpage sc-productpage" id="main">
          <div className="sc-refskeleton" aria-hidden>
            <span className="sc-refskeleton-title" />
            <span className="sc-refskeleton-stage" />
            <span className="sc-refskeleton-rail">
              <span />
              <span />
              <span />
            </span>
          </div>
          <p className="sc-vh" role="status">
            Loading this product
          </p>
        </main>
      </ScrollPane>
    );
  }

  if (!product && !demoProduct) {
    return (
      <ScrollPane>
        <main className="sc-lookpage" id="main">
          <h1>This product isn't here anymore</h1>
          <p className="sc-lookpage-lede">It may have been removed, or the link is out of date.</p>
          <div className="sc-lookpage-acts">
            <Link className="sc-btn sc-btn-primary" to={productsPath(brand)}>
              Browse products
            </Link>
          </div>
        </main>
      </ScrollPane>
    );
  }

  const editable: Editable = demoProduct ? 'none' : isManual ? 'full' : 'fields';
  const subject = (product ?? demoProduct) as Product | DemoProduct;
  const id = product?.id ?? demoProduct!.id;
  const categoryKey = product ? effectiveCategory(product) : (demoProduct?.category ?? null);
  const house = displayBrand(subject);

  const toRef = (shot: { file: string; angle?: string | null }): ProductRef[] => {
    const url = assetUrl(shot.file);
    return url ? [{ file: shot.file, url, angle: shot.angle }] : [];
  };
  const refs: ProductRef[] = demoProduct
    ? demoFrames.map((f) => ({ file: f.angle, url: f.url, angle: f.angle }))
    : (product?.shots ?? []).flatMap(toRef);

  /**
   * Take one image out of the set, and say so with the way back attached.
   *
   * The set is whatever the list names, so undoing is the same write with the
   * old list — which restores the position too, not just the membership. That
   * a store image is excluded rather than deleted underneath (an import would
   * otherwise hand it straight back) is the server's problem, not something
   * the page should make anyone learn.
   */
  const removeRef = (file: string) => {
    const before = refs.map((r) => r.file);
    const position = before.indexOf(file) + 1;
    void run(
      api.setProductShots(
        brand.id,
        id,
        before.filter((f) => f !== file),
      ),
    ).then(() =>
      push({
        kind: 'success',
        title: 'Reference removed',
        // which one: removing three in a row produced three identical toasts,
        // and no way to tell which Undo brought back which
        detail: `Reference ${position} of ${before.length}`,
        action: {
          label: 'Undo',
          onClick: () => void run(api.setProductShots(brand.id, id, before)),
        },
      }),
    );
  };

  const note = demoProduct
    ? 'Our reference set. Yours replaces it.'
    : refs.length === 0
      ? isManual
        ? 'No reference yet.'
        : 'No reference yet. Images from your store are still arriving.'
      : refs.length === 1
        ? "One angle. A shot has to guess at every side it can't see."
        : refs.length === 2
          ? 'Two angles. A third pins the shape.'
          : 'The first three build every shot. Remove any that show a different colour or version.';

  const addLabel = editable === 'none' ? null : 'Add image';

  // A scraped description runs to any length. Keep the first sentence when it
  // is a reasonable one, else a hard cap: enough to say what the thing is,
  // never enough to push the product off the screen.
  const catalogCopy = product?.descriptionHtml ? firstSentence(stripHtml(product.descriptionHtml), 200) : '';
  const lede = demoProduct?.description || catalogCopy || null;

  const rest = demoProduct ? [demoProduct.subcategory] : [product?.variant, product?.material, product?.dimensions];
  const facts = [editable === 'none' ? categoryLabel(categoryKey) : null, ...rest].filter(Boolean);

  const others = demoProduct
    ? demoProducts.filter((d) => d.id !== id).slice(0, 8)
    : products.filter((p) => p.id !== id).slice(0, 8);

  return (
    <ScrollPane>
      <main className="sc-lookpage sc-productpage" id="main">
        <div className="sc-lookpage-crumb">
          <Link to={productsPath(brand)}>Products</Link>
          <span>/</span>
          <span>{demoProduct ? 'Scenri library' : isManual ? 'Yours' : 'From your store'}</span>
        </div>

        {house && (
          <p className="sc-lookpage-house">
            <em className="sc-accent">{house}</em>
          </p>
        )}
        {editable === 'full' ? (
          <TitleField
            value={name}
            onChange={(v) => {
              setName(v);
              patch({ name: v });
            }}
          />
        ) : (
          <h1 dir="auto">{subject.name}</h1>
        )}
        {lede && <p className="sc-lookpage-lede">{lede}</p>}
        {facts.length > 0 && <p className="sc-lookpage-facts">{facts.join(' · ')}</p>}

        <div className="sc-lookpage-acts">
          {editable !== 'none' && <CategoryPicker value={categoryKey} onChange={(k) => patch({ category: k })} />}
          <button type="button" className="sc-btn sc-btn-primary" onClick={() => applyProduct(id)}>
            Use in a shot
          </button>
        </div>

        {err && <p className="sc-assetform-err">{err}</p>}

        <ProductReferences
          refs={refs}
          cap={PRODUCT_REF_MAX}
          note={note}
          addLabel={addLabel}
          busy={busy}
          onAdd={editable === 'none' ? undefined : (file) => void run(addProductShot(brand.id, id, file))}
          onPromote={
            editable === 'none'
              ? undefined
              : (file) =>
                  void run(
                    api.setProductShots(brand.id, id, [file, ...refs.map((r) => r.file).filter((f) => f !== file)]),
                  )
          }
          onRemove={editable === 'none' ? undefined : removeRef}
        />

        {made.length > 0 && (
          <Slider label={`Shots featuring ${subject.name}`}>
            {made.map((s) => (
              <ShotThumb key={s.id} node={s} to={shotPath(brand, null, s.id)} />
            ))}
          </Slider>
        )}

        {others.length > 0 && (
          <Slider label={demoProduct ? 'Other products in the library' : 'Other products'}>
            {others.map((p) =>
              demoProduct ? (
                <DemoProductCard
                  key={p.id}
                  product={p as DemoProduct}
                  variant="navigate"
                  size="slider"
                  onOpen={(pid) => navigate(productPath(brand, pid))}
                  href={productPath(brand, p.id)}
                />
              ) : (
                <ProductCard
                  key={p.id}
                  product={p as Product}
                  variant="navigate"
                  size="slider"
                  onOpen={(pid) => navigate(productPath(brand, pid))}
                  href={productPath(brand, p.id)}
                />
              ),
            )}
          </Slider>
        )}

        {product && (
          <div className="sc-ownedbits">
            <div className="sc-lookpage-acts">
              <Confirm
                label="Delete product"
                title={`Delete ${product.name}?`}
                body="Shots already made with it keep their images and their recipe. Only future shots lose it."
                busy={removing}
                onConfirm={() => void remove()}
              />
            </div>
          </div>
        )}
      </main>
    </ScrollPane>
  );
}
