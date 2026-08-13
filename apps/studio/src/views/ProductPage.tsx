import { useEffect, useMemo, useRef, useState } from 'react';
import { productLabel } from '../displayName.js';
import { useNavigate, useParams } from 'react-router';
import { Callout, Flex, Select, Text, TextField } from '@radix-ui/themes';
import { api, assetUrl, addProductShot, type Product } from '../api.js';

/** Mirrors PRODUCT_REF_MAX in packages/cli/src/brief.ts — the number of product images a brief actually attaches. */
const PRODUCT_REF_MAX = 3;
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useApplyProduct } from '../app/useApplyProduct.js';
import { productPath, productsPath, shotPath } from '../routes.js';
import { DemoProductCard } from '../layout/DemoProductCard.js';
import { ProductCard } from '../layout/ProductCard.js';
import { EmptyRefFrame, RefFrame, ShotThumb, Slider, UploadRefFrame } from '../layout/ReferenceGallery.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { categoryLabel, categoryOf, effectiveCategory, PRODUCT_CATEGORIES } from '../productCategories.js';

/**
 * One product — the source of truth for what it actually looks like before
 * it goes into a scene. A manual product gets a per-category reference
 * checklist it can fill in directly; a catalog product shows whatever the
 * store already gave it, since its images and copy live there, not here.
 */
export function ProductPage() {
  const { productId = '' } = useParams();
  const { brand, products, nodes: shots, refresh } = useBrand();
  const navigate = useNavigate();
  const applyProduct = useApplyProduct();
  const [uploadingAngle, setUploadingAngle] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const product = products.find((p) => p.id === productId);
  const isManual = (product?.origin ?? 'manual') === 'manual';

  // A demo product is a global catalog object, like a presenter — it has no
  // brand and nothing about it is editable. It still deserves a page: the whole
  // homepage wall is built from these, and without one every reference to a
  // demo product is a dead end.
  const { demoProducts, demoProductsLoaded } = useAppData();
  const demoProduct = useMemo(
    () => (product ? undefined : demoProducts.find((d) => d.id === productId)),
    [product, demoProducts, productId],
  );
  const [demoFrames, setDemoFrames] = useState<{ angle: string; url: string }[]>([]);
  // Component state, not a URL param: this is a per-product view toggle, and a
  // URL-backed one survives back/forward, so a product opened later could show
  // its whole set with no obvious reason why. ProductRoute keys on productId,
  // so this resets to collapsed on every product.
  const [openAll, setOpenAll] = useState(false);
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
  const [variant, setVariant] = useState(product?.variant ?? '');
  const [material, setMaterial] = useState(product?.material ?? '');
  const [dimensions, setDimensions] = useState(product?.dimensions ?? '');
  useEffect(() => {
    setName(product?.name ?? '');
    setVariant(product?.variant ?? '');
    setMaterial(product?.material ?? '');
    setDimensions(product?.dimensions ?? '');
    // resync only when switching products, so an in-flight edit doesn't get
    // overwritten by the next 4s library poll landing mid-keystroke
  }, [product?.id]);

  const categoryKey = product ? effectiveCategory(product) : null;
  const category = categoryOf(categoryKey);

  const patchManual = (patch: Partial<Pick<Product, 'name' | 'category' | 'variant' | 'material' | 'dimensions'>>) => {
    if (!product) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void api
        .updateProduct(brand.id, product.id, patch)
        .then(() => refresh())
        .catch((e: any) => setErr(String(e.message ?? e)));
    }, 500);
  };

  const onCategoryChange = (key: string) => {
    if (!product) return;
    if (isManual) patchManual({ category: key });
    else
      void api
        .updateCatalogProductCategory(brand.id, product.id, key)
        .then(() => refresh())
        .catch((e: any) => setErr(String(e.message ?? e)));
  };

  const uploadAngle = async (angleKey: string, file: File) => {
    if (!product) return;
    setUploadingAngle(angleKey);
    setErr(null);
    try {
      await addProductShot(brand.id, product.id, file, angleKey);
      await refresh();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setUploadingAngle(null);
    }
  };

  /** Shots whose brief attached this product. */
  const made = useMemo(
    () =>
      shots
        .filter(
          (s) =>
            s.status === 'done' &&
            s.images.length > 0 &&
            (s.brief?.tokens ?? []).some((t: any) => t?.t === 'product' && t.id === productId),
        )
        .slice(-12)
        .reverse(),
    [shots, productId],
  );

  const others = products.filter((p) => p.id !== productId).slice(0, 8);

  if (!product && demoProduct) {
    const label = categoryLabel(demoProduct.category);
    const others = demoProducts.filter((d) => d.id !== demoProduct.id).slice(0, 8);
    return (
      <ScrollPane>
        <main className="sc-lookpage sc-productpage" id="main">
          <div className="sc-lookpage-crumb">
            <button type="button" onClick={() => navigate(productsPath(brand))}>
              Products
            </button>
            <span>/</span>
            <span>{label}</span>
          </div>

          <h1 dir="auto">{productLabel(demoProduct, 'heading')}</h1>
          <p className="sc-lookpage-lede">{demoProduct.description}</p>
          <p className="sc-lookpage-facts">
            {label}
            {demoProduct.subcategory ? ` · ${demoProduct.subcategory}` : ''} · from the Scenri library
          </p>
          <div className="sc-lookpage-acts">
            <button type="button" className="sc-btn sc-btn-primary" onClick={() => applyProduct(demoProduct.id)}>
              Use in a shot
            </button>
          </div>

          {demoFrames.length > 0 ? (
            <>
              <div className="sc-lookpage-refs">
                {(openAll ? demoFrames : demoFrames.slice(0, PRODUCT_REF_MAX)).map((f) => (
                  <RefFrame key={f.angle} src={f.url} />
                ))}
              </div>
              <p className="sc-lookpage-note">
                A reference set we shot. The first {PRODUCT_REF_MAX} are what a shot is built from — yours replaces
                them.
              </p>
              {demoFrames.length > PRODUCT_REF_MAX && (
                <button type="button" className="sc-lookpage-expand" onClick={() => setOpenAll(!openAll)}>
                  {openAll ? 'Enough, close it' : `See all ${demoFrames.length} angles`}
                </button>
              )}
            </>
          ) : (
            <EmptyRefFrame />
          )}

          {made.length > 0 && (
            <Slider label={`Shots featuring ${demoProduct.name}`}>
              {made.map((s) => (
                <ShotThumb key={s.id} node={s} onClick={() => navigate(shotPath(brand, null, s.id))} />
              ))}
            </Slider>
          )}

          {others.length > 0 && (
            <Slider label="Other products in the library">
              {others.map((d) => (
                <DemoProductCard
                  key={d.id}
                  product={d}
                  variant="navigate"
                  size="slider"
                  onOpen={(id) => navigate(productPath(brand, id))}
                />
              ))}
            </Slider>
          )}
        </main>
      </ScrollPane>
    );
  }

  // The library poll can land after the first paint; don't flash "gone".
  if (!product && !demoProductsLoaded) {
    return (
      <ScrollPane>
        <main className="sc-lookpage" id="main">
          <div className="sc-tplrow" aria-hidden />
        </main>
      </ScrollPane>
    );
  }

  if (!product) {
    return (
      <ScrollPane>
        <main className="sc-lookpage" id="main">
          <h1>This product isn't here anymore</h1>
          <p className="sc-lookpage-lede">It may have been removed, or the link is out of date.</p>
          <div className="sc-lookpage-acts">
            <button type="button" className="sc-btn sc-btn-primary" onClick={() => navigate(productsPath(brand))}>
              Browse products
            </button>
          </div>
        </main>
      </ScrollPane>
    );
  }

  const extraShots = (product.shots ?? []).filter((s) => !s.angle || !category.angles.some((a) => a.key === s.angle));

  /**
   * What the generator will actually send, stated plainly.
   *
   * compileBrief attaches up to PRODUCT_REF_MAX images and switches directive
   * on the count: with more than one it says "the attached product images all
   * show the exact same product from different angles ... do not redesign it";
   * with one it falls back to a markedly weaker line. So the number of images
   * a product has is not cosmetic, and the page should not imply otherwise.
   * A catalog product cannot be topped up here — the shots route only accepts
   * products that live in the brand's own products[] — so its advice points at
   * the store instead of at an upload button that would 404.
   */
  const usable = (product.shots ?? []).length;
  const refNote =
    usable >= PRODUCT_REF_MAX
      ? `The first ${PRODUCT_REF_MAX} are what a shot is built from.`
      : usable > 1
        ? `Both are used when building a shot. A third angle would pin its shape more tightly.`
        : isManual
          ? 'Only one reference, so a shot has to guess at every face it cannot see. Add a second angle below.'
          : 'Only one image came from your store, so a shot has to guess at every face it cannot see. Add more images to this product in your store, then re-import.';

  return (
    <ScrollPane>
      <main className="sc-lookpage sc-productpage" id="main">
        <div className="sc-lookpage-crumb">
          <button type="button" onClick={() => navigate(productsPath(brand))}>
            Products
          </button>
          <span>/</span>
          <span>{category.label}</span>
        </div>

        <h1 dir="auto">{productLabel(product, 'heading')}</h1>
        <p className="sc-lookpage-facts">
          {category.label}
          {product.variant ? ` · ${product.variant}` : ''}
          {isManual ? '' : ` · ${product.vendor ?? 'from your store'}`}
        </p>
        <div className="sc-lookpage-acts">
          <button type="button" className="sc-btn sc-btn-primary" onClick={() => applyProduct(product.id)}>
            Use in a shot
          </button>
        </div>

        {err && (
          <Callout.Root color="red" size="1" style={{ marginBottom: 16 }}>
            <Callout.Text>{err}</Callout.Text>
          </Callout.Root>
        )}

        <Flex direction="column" gap="3" className="sc-kit-sec" style={{ marginBottom: 32 }}>
          <div className="sc-sec-head">
            <span className="sc-sec-title">Details</span>
          </div>
          <Flex gap="3" wrap="wrap">
            <div style={{ minWidth: 200, flex: 1 }}>
              <Text size="1" color="gray" as="p" mb="1">
                Category
              </Text>
              <Select.Root value={categoryKey ?? 'other'} onValueChange={onCategoryChange}>
                <Select.Trigger style={{ width: '100%' }} aria-label="Category" />
                <Select.Content>
                  {PRODUCT_CATEGORIES.map((c) => (
                    <Select.Item key={c.key} value={c.key}>
                      {c.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
            {isManual ? (
              <>
                <div style={{ minWidth: 200, flex: 1 }}>
                  <Text size="1" color="gray" as="p" mb="1">
                    Name
                  </Text>
                  <TextField.Root
                    aria-label="Name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      patchManual({ name: e.target.value });
                    }}
                  />
                </div>
                <div style={{ minWidth: 200, flex: 1 }}>
                  <Text size="1" color="gray" as="p" mb="1">
                    Variant
                  </Text>
                  <TextField.Root
                    aria-label="Variant"
                    placeholder="Color, size…"
                    value={variant}
                    onChange={(e) => {
                      setVariant(e.target.value);
                      patchManual({ variant: e.target.value });
                    }}
                  />
                </div>
                <div style={{ minWidth: 200, flex: 1 }}>
                  <Text size="1" color="gray" as="p" mb="1">
                    Material
                  </Text>
                  <TextField.Root
                    aria-label="Material"
                    value={material}
                    onChange={(e) => {
                      setMaterial(e.target.value);
                      patchManual({ material: e.target.value });
                    }}
                  />
                </div>
                <div style={{ minWidth: 200, flex: 1 }}>
                  <Text size="1" color="gray" as="p" mb="1">
                    Dimensions
                  </Text>
                  <TextField.Root
                    aria-label="Dimensions"
                    value={dimensions}
                    onChange={(e) => {
                      setDimensions(e.target.value);
                      patchManual({ dimensions: e.target.value });
                    }}
                  />
                </div>
              </>
            ) : (
              <Text size="1" color="gray">
                Name, price and vendor come from your store — only the category above is editable here.
              </Text>
            )}
          </Flex>
        </Flex>

        {isManual ? (
          <div className="sc-lookpage-refs">
            {category.angles.map((a) => {
              const shot = product.shots?.find((s) => s.angle === a.key);
              const url = shot ? assetUrl(shot.file) : null;
              return url ? (
                <RefFrame key={a.key} src={url} />
              ) : (
                <UploadRefFrame
                  key={a.key}
                  label={a.label}
                  busy={uploadingAngle === a.key}
                  onUpload={(file) => void uploadAngle(a.key, file)}
                />
              );
            })}
            {extraShots.map((s) => {
              const url = assetUrl(s.file);
              return url ? <RefFrame key={s.file} src={url} /> : null;
            })}
          </div>
        ) : (product.shots ?? []).length > 0 ? (
          <>
            <div className="sc-lookpage-refs">
              {(openAll ? (product.shots ?? []) : (product.shots ?? []).slice(0, PRODUCT_REF_MAX)).map((s) => {
                const url = assetUrl(s.file);
                return url ? <RefFrame key={s.file} src={url} /> : null;
              })}
            </div>
            <p className="sc-lookpage-note">{refNote}</p>
            {(product.shots ?? []).length > PRODUCT_REF_MAX && (
              <button type="button" className="sc-lookpage-expand" onClick={() => setOpenAll(!openAll)}>
                {openAll ? 'Enough, close it' : `See all ${(product.shots ?? []).length} images`}
              </button>
            )}
          </>
        ) : (
          <EmptyRefFrame />
        )}

        {made.length > 0 && (
          <Slider label={`Shots featuring ${product.name}`}>
            {made.map((s) => (
              <ShotThumb key={s.id} node={s} onClick={() => navigate(shotPath(brand, null, s.id))} />
            ))}
          </Slider>
        )}

        {others.length > 0 && (
          <Slider label="Other products">
            {others.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                variant="navigate"
                size="slider"
                onOpen={(id) => navigate(productPath(brand, id))}
              />
            ))}
          </Slider>
        )}
      </main>
    </ScrollPane>
  );
}
