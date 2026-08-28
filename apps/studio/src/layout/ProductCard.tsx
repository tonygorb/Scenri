import { assetUrl, type Product } from '../api.js';
import { productLabel } from '../displayName.js';
import { categoryLabel } from '../productCategories.js';
import { CatalogCard, CatalogCardSkeleton, type CatalogCardSize, type CatalogCardVariant } from './CatalogCard.js';

export type ProductCardVariant = CatalogCardVariant;
export type ProductCardSize = CatalogCardSize;

/**
 * The one Product card — same variant/size split as SceneCard/PresenterCard
 * (the shared LookCard pattern): the caption is name + category (and
 * variant, when set), the fast path is "Use in a shot". A thin adapter
 * over `CatalogCard` — see CatalogCard.tsx for the shared shell.
 */
export function ProductCard({
  product,
  variant,
  onOpen,
  onUse,
  href,
  selected,
  onToggle,
  size = 'grid',
}: {
  product: Product;
  onOpen?: (id: string) => void;
  /** `use` only: the fast-path action, shown as a sibling button when `onOpen` is present. */
  onUse?: (id: string) => void;
  /** Forwarded to CatalogCard: the open surface's real route (see CatalogCard.href). */
  href?: string;
  /** `select` only. */
  selected?: boolean;
  onToggle?: (id: string) => void;
  variant: ProductCardVariant;
  size?: ProductCardSize;
}) {
  const cat = categoryLabel(product.category);
  const secondary = cat && product.variant ? `${cat} · ${product.variant}` : (cat ?? product.variant ?? '');
  return (
    <CatalogCard
      id={product.id}
      previewUrl={assetUrl(product.shots?.[0]?.file)}
      title={productLabel(product, 'tooltip')}
      primary={productLabel(product, 'card')}
      secondary={secondary}
      useLabel="Use in a shot"
      variant={variant}
      onOpen={onOpen}
      onUse={onUse}
      href={href}
      selected={selected}
      onToggle={onToggle}
      size={size}
    />
  );
}

/** One skeleton shape, every list that hasn't resolved the product library yet. */
export function ProductCardSkeleton(props: { size?: ProductCardSize; count?: number }) {
  return <CatalogCardSkeleton {...props} />;
}
