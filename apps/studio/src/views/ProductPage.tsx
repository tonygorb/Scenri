import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PencilSimple } from '@phosphor-icons/react';
import {
  api,
  assetUrl,
  addProductShot,
  deleteProduct,
  type Brand,
  type DemoProduct,
  type Product,
  type ProductSize,
} from '../api.js';
import { Confirm } from '../Confirm.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useMadeWith } from './useMadeWith.js';
import { useApplyProduct } from '../app/useApplyProduct.js';
import { useToasts } from '../toasts.js';
import { useTitleEntity } from '../useDocumentTitle.js';
import { useStillHere } from '../useStillHere.js';
import { productPath, productsPath, shotPath } from '../routes.js';
import { DemoProductCard } from '../layout/DemoProductCard.js';
import { ProductCard } from '../layout/ProductCard.js';
import { ProductReferences, type ProductRef } from '../layout/ProductReferences.js';
import { ShotThumb, Slider } from '../layout/ReferenceGallery.js';
import { LineField } from '../layout/LineField.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { RecordCrumb } from '../layout/RecordCrumb.js';
import { RecordKeep } from '../layout/RecordKeep.js';
import { Tip } from '../layout/Tip.js';
import { ProductDetailsDialog } from './ProductDetailsDialog.js';
import { categoryLabel, effectiveCategory } from '../productCategories.js';
import { sizeChips } from '../sizeChips.js';

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
 * One product — the record of what it actually looks like, and the place its
 * references get corrected.
 *
 * Same look-page as a presenter or a scene: identity, one action, then the
 * pictures. The pictures are the difference — one object from several sides,
 * swapped in a single frame, not a grid of equal looks.
 */
export function ProductPage() {
  const { productId = '' } = useParams();
  const { brand, products, refreshProducts } = useBrand();
  const { demoProducts, demoProductsLoaded, applyBrand, refreshBrands } = useAppData();
  const navigate = useNavigate();
  const applyProduct = useApplyProduct();
  const { push } = useToasts();

  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Every field edited since the last write, sent together when the pause ends. */
  const pending = useRef<Partial<Pick<Product, 'name' | 'category' | 'variant' | 'material' | 'dimensions'>>>({});
  const deleting = useRef(false);
  const stillHere = useStillHere();

  const listed = products.find((p) => p.id === productId);
  /**
   * The whole product, fetched for this page alone.
   *
   * The library list carries one picture per product on purpose - all of them
   * for 2,201 products was 2.9 MB of response the grid never read. This page
   * is the one surface that shows every picture, so it is the one that asks.
   */
  const [full, setFull] = useState<Product | null>(null);
  useEffect(() => {
    if (listed?.origin !== 'catalog') {
      setFull(null);
      return;
    }
    let alive = true;
    void api
      .libraryProduct(brand.id, listed.id)
      .then((r) => {
        if (alive) setFull(r.product);
      })
      .catch(() => {
        // The listed entry still has a name and a picture; it is not nothing.
      });
    return () => {
      alive = false;
    };
  }, [brand.id, listed]);
  // The list entry carries every field but the pictures, and it is the one
  // that moves when the product is edited: letting this page's own fetch win
  // showed the category from before an edit until that fetch came round again.
  const product = full && listed && full.id === listed.id ? { ...full, ...listed, shots: full.shots } : listed;
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

  /**
   * How large it really is. Nobody fills this in: the first look reads it from
   * the photograph (a few seconds, once), and the Details sheet corrects it.
   */
  const [size, setSize] = useState<ProductSize | null>(null);
  const [details, setDetails] = useState(false);
  const [savingSize, setSavingSize] = useState(false);
  const [sizeErr, setSizeErr] = useState<string | null>(null);
  const known = !!(product ?? demoProduct);
  useEffect(() => {
    setSize(null);
    if (!known || !productId) return;
    let alive = true;
    void api
      .productSize(brand.id, productId)
      .then((r) => {
        if (alive) setSize(r.size);
      })
      .catch(() => {
        // No size is a quiet absence: the page never says it failed to guess.
      });
    return () => {
      alive = false;
    };
  }, [brand.id, productId, known]);
  const saveSize = async (words: string) => {
    if (!productId) return false;
    const here = stillHere();
    setSavingSize(true);
    setSizeErr(null);
    try {
      const r = await api.setProductSize(brand.id, productId, words);
      if (here()) {
        setSize(r.size);
        setDetails(false);
      }
      return true;
    } catch (e: any) {
      setSizeErr(String(e.message ?? e));
      return false;
    } finally {
      setSavingSize(false);
    }
  };

  const isManual = (product?.origin ?? 'manual') === 'manual';

  /**
   * Where a write's answer goes, by what the product is.
   *
   * A hand-made product lives in the brand document: its answer is the brand,
   * applied like every other brand write, and the library follows the brand.
   * A store product lives in the catalog, which only a re-read of the library
   * can show. The answer used to be thrown away and the library re-read for
   * both, which left the brand the studio holds a version behind, and the next
   * whole-brand save (a colour, a tagline) wrote the old product back to disk.
   */
  const landed = async (answer: unknown, manual: boolean) => {
    if (manual && answer && typeof answer === 'object' && 'json' in answer) applyBrand(answer as Brand);
    else await refreshProducts();
  };

  /**
   * One pause for every field, so the write carries every field edited since
   * the last one: a name typed and a category picked inside half a second used
   * to send the category alone and lose the name.
   */
  const patch = (p: Partial<Pick<Product, 'name' | 'category' | 'variant' | 'material' | 'dimensions'>>) => {
    if (!product || deleting.current) return;
    pending.current = { ...pending.current, ...p };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const forBrand = brand.id;
    const id = product.id;
    const manual = isManual;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      const body = pending.current;
      pending.current = {};
      const write = manual ? api.updateProduct(forBrand, id, body) : api.updateCatalogProduct(forBrand, id, body);
      void write.then((answer) => landed(answer, manual)).catch((e: any) => setErr(String(e.message ?? e)));
    }, 500);
  };

  /** Filing and size leave together. A size the server refuses keeps the sheet open and leaves the category alone. */
  const saveDetails = async (next: { size: string; category: string }) => {
    const shown = size?.text ?? '';
    const sizeChanged = next.size.trim().toLowerCase() !== shown.trim().toLowerCase();
    if (sizeChanged) {
      const ok = await saveSize(next.size);
      if (!ok) return;
    }
    if (next.category !== (categoryKey ?? 'other')) patch({ category: next.category });
    if (!sizeChanged) setDetails(false);
  };

  const run = async (job: Promise<unknown>) => {
    const manual = isManual;
    setBusy(true);
    setErr(null);
    try {
      await landed(await job, manual);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Delete, and every surface stops showing the product in the same commit:
   * the wall this lands on, the Home count and the pickers all read the
   * library, which follows the brand. It used to re-read the brand's sets and
   * shots instead, so the card stayed until a reload.
   */
  const remove = async () => {
    if (!product || deleting.current) return;
    deleting.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    pending.current = {};
    const here = stillHere();
    const wall = productsPath(brand);
    const catalog = product.origin === 'catalog' || product.id.startsWith('cat-');
    setRemoving(true);
    setErr(null);
    try {
      if (catalog) {
        await api.deleteCatalogProduct(brand.id, product.id);
        await refreshProducts();
      } else {
        applyBrand(await deleteProduct(brand.id, product.id));
      }
    } catch (e: any) {
      if (e?.status !== 404) {
        deleting.current = false;
        if (here()) {
          setErr(String(e.message ?? e));
          setRemoving(false);
        }
        return;
      }
      // Already gone: the outcome asked for is true, so read the truth and carry on.
      await Promise.all([refreshBrands(), refreshProducts()]);
    }
    // Replace: Back must not land on the page of a product that is gone. And
    // only if this page is still the one on screen.
    if (here()) navigate(wall, { replace: true });
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

  // The size is said as chips, one dimension each. The record's own field is
  // what it was read from, and only stands in when there is no size to say.
  const sizes = sizeChips(size?.text ?? '');
  const rest = demoProduct
    ? [demoProduct.subcategory]
    : [product?.variant, product?.material, sizes.length ? null : product?.dimensions];
  const filed = categoryLabel(categoryKey);
  const facts = rest.filter(Boolean);

  const others = demoProduct
    ? demoProducts.filter((d) => d.id !== id).slice(0, 8)
    : products.filter((p) => p.id !== id).slice(0, 8);

  return (
    <ScrollPane>
      <main className="sc-lookpage sc-productpage" id="main">
        <RecordCrumb
          to={productsPath(brand)}
          wall="Products"
          where={demoProduct ? 'Scenri library' : isManual ? 'Yours' : 'From your store'}
        />

        {house && (
          <p className="sc-lookpage-house">
            <em className="sc-accent">{house}</em>
          </p>
        )}
        {editable === 'full' ? (
          <LineField
            label="Product name"
            value={name}
            onChange={(v) => {
              setName(v);
              patch({ name: v });
            }}
          />
        ) : (
          <h1 dir="auto">{subject.name}</h1>
        )}
        {(filed || sizes.length > 0) && (
          <div className="sc-lookpage-marks">
            {filed && (
              <ul className="sc-lookpage-cats" aria-label="Filed under">
                <li className="sc-chip" data-static>
                  {filed}
                </li>
              </ul>
            )}
            {sizes.length > 0 && (
              <ul className="sc-lookpage-cats" aria-label="Size">
                {sizes.map((label) => (
                  <li key={label} className="sc-chip" data-static>
                    {label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {lede && <p className="sc-lookpage-lede">{lede}</p>}
        {facts.length > 0 && <p className="sc-lookpage-facts">{facts.join(' · ')}</p>}

        <div className="sc-lookpage-acts">
          <button type="button" className="sc-btn sc-btn-primary" onClick={() => applyProduct(id)}>
            Use in a shot
          </button>
          <RecordKeep kind="product" brandId={brand.id} id={id} />
          {editable !== 'none' && (
            <Tip label="Edit details">
              <button
                type="button"
                className="sc-icon-btn"
                aria-label="Edit details"
                aria-haspopup="dialog"
                onClick={() => {
                  setSizeErr(null);
                  setDetails(true);
                }}
              >
                <PencilSimple size={17} />
              </button>
            </Tip>
          )}
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

        {details && (
          <ProductDetailsDialog
            size={size}
            category={categoryKey}
            busy={savingSize}
            error={sizeErr}
            onSave={(next) => void saveDetails(next)}
            onDismiss={() => setDetails(false)}
          />
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
