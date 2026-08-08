import type { DemoProduct } from '../api.js';
import { categoryLabel } from '../productCategories.js';
import { CatalogCard, CatalogCardSkeleton, type CatalogCardSize, type CatalogCardVariant } from './CatalogCard.js';

export type DemoProductCardVariant = CatalogCardVariant;
export type DemoProductCardSize = Exclude<CatalogCardSize, 'shelf'>;

/**
 * One Scenri Library card — a curated starter product, not the user's own.
 * Same shell as PresenterCard (a global, always-available catalog, not
 * brand-scoped), adapted for a product: caption is name + category, fast
 * path is "Use in a brief". Using one attaches a normal {t:'product'} token
 * exactly like a real product would — it never gets written into the
 * brand's own products[].
 */
export function DemoProductCard({
  product,
  variant,
  onOpen,
  onUse,
  size = 'grid',
}: {
  product: DemoProduct;
  onOpen?: (id: string) => void;
  onUse?: (id: string) => void;
  variant: DemoProductCardVariant;
  size?: DemoProductCardSize;
}) {
  const category = categoryLabel(product.category) ?? product.category;
  return (
    <CatalogCard
      id={product.id}
      previewUrl={product.previewUrl}
      title={`${product.name} — ${category}`}
      primary={product.name}
      secondary={category}
      useLabel="Use in a brief"
      variant={variant}
      onOpen={onOpen}
      onUse={onUse}
      size={size}
    />
  );
}

/** One skeleton shape, every list that hasn't resolved the demo product catalog yet. */
export function DemoProductCardSkeleton(props: { size?: DemoProductCardSize; count?: number }) {
  return <CatalogCardSkeleton {...props} />;
}
