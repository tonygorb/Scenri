import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Callout, Flex, Select, Text, TextField } from '@radix-ui/themes';
import { api, assetUrl, addProductShot, type Product } from '../api.js';
import { useBrand } from '../app/BrandLayout.js';
import { useApplyProduct } from '../app/useApplyProduct.js';
import { productPath, productsPath, shotPath } from '../routes.js';
import { ProductCard } from '../layout/ProductCard.js';
import { EmptyRefFrame, RefFrame, ShotThumb, Slider, UploadRefFrame } from '../layout/ReferenceGallery.js';
import { categoryOf, effectiveCategory, PRODUCT_CATEGORIES } from '../productCategories.js';

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

  if (!product) {
    return (
      <div className="sc-home">
        <main className="sc-lookpage" id="main">
          <h1>This product isn't here anymore</h1>
          <p className="sc-lookpage-lede">It may have been removed, or the link is out of date.</p>
          <div className="sc-lookpage-acts">
            <button type="button" className="sc-btn sc-btn-primary" onClick={() => navigate(productsPath(brand))}>
              Browse products
            </button>
          </div>
        </main>
      </div>
    );
  }

  const extraShots = (product.shots ?? []).filter((s) => !s.angle || !category.angles.some((a) => a.key === s.angle));

  return (
    <div className="sc-home">
      <main className="sc-lookpage sc-productpage" id="main">
        <div className="sc-lookpage-crumb">
          <button type="button" onClick={() => navigate(productsPath(brand))}>
            Products
          </button>
          <span>/</span>
          <span>{category.label}</span>
        </div>

        <h1 dir="auto">{product.name}</h1>
        <p className="sc-lookpage-facts">
          {category.label}
          {product.variant ? ` · ${product.variant}` : ''}
          {isManual ? '' : ` · ${product.vendor ?? 'from your store'}`}
        </p>
        <div className="sc-lookpage-acts">
          <button type="button" className="sc-btn sc-btn-primary" onClick={() => applyProduct(product.id)}>
            Use in creation
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
          <div className="sc-lookpage-refs">
            {(product.shots ?? []).map((s) => {
              const url = assetUrl(s.file);
              return url ? <RefFrame key={s.file} src={url} /> : null;
            })}
          </div>
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
    </div>
  );
}
