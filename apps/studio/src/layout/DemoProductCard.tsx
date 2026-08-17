import type { DemoProduct } from '../api.js';
import { productLabel } from '../displayName.js';
import { categoryLabel } from '../productCategories.js';
import { CatalogCard, CatalogCardSkeleton, type CatalogCardSize, type CatalogCardVariant } from './CatalogCard.js';

export type DemoProductCardVariant = CatalogCardVariant;
export type DemoProductCardSize = Exclude<CatalogCardSize, 'shelf'>;

/**
 * One Scenri library card — a curated starter product, not the user's own.
 * Same shell as PresenterCard (a global, always-available catalog, not
 * brand-scoped), adapted for a product: caption is name + category, fast
 * path is "Use in a shot". Using one attaches a normal {t:'product'} token
 * exactly like a real product would — it never gets written into the
 * brand's own products[].
 */
export function DemoProductCard({
  product,
  variant,
  onOpen,
  onUse,
  selected,
  onToggle,
  size = 'grid',
}: {
  product: DemoProduct;
  onOpen?: (id: string) => void;
  onUse?: (id: string) => void;
  selected?: boolean;
  onToggle?: (id: string) => void;
  variant: DemoProductCardVariant;
  size?: DemoProductCardSize;
}) {
  const category = categoryLabel(product.category) ?? product.category;
  return (
    <CatalogCard
      id={product.id}
      previewUrl={product.previewUrl}
      title={`${productLabel(product, 'tooltip')} — ${category}`}
      primary={productLabel(product, 'card')}
      secondary={category}
      useLabel="Use in a shot"
      variant={variant}
      onOpen={onOpen}
      onUse={onUse}
      selected={selected}
      onToggle={onToggle}
      size={size}
    />
  );
}

/** One skeleton shape, every list that hasn't resolved the demo product catalog yet. */
export function DemoProductCardSkeleton(props: { size?: DemoProductCardSize; count?: number }) {
  return <CatalogCardSkeleton {...props} />;
}
