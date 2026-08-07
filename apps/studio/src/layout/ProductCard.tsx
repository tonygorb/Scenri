import { assetUrl, type Product } from '../api.js';
import { categoryLabel } from '../productCategories.js';
import { CatalogCard, CatalogCardSkeleton, type CatalogCardSize, type CatalogCardVariant } from './CatalogCard.js';

export type ProductCardVariant = CatalogCardVariant;
export type ProductCardSize = CatalogCardSize;

/**
 * The one Product card — same variant/size split as SceneCard/PresenterCard
 * (docs/product/patterns/look-card.md): the caption is name + category (and
 * variant, when set), the fast path is "Use in creation". A thin adapter
 * over `CatalogCard` — see CatalogCard.tsx for the shared shell.
 */
export function ProductCard({
  product,
  variant,
  onOpen,
  onUse,
  selected,
  onToggle,
  size = 'grid',
}: {
  product: Product;
  onOpen?: (id: string) => void;
  /** `use` only: the fast-path action, shown as a sibling button when `onOpen` is present. */
  onUse?: (id: string) => void;
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
      title={product.name}
      primary={product.name}
      secondary={secondary}
      useLabel="Use in creation"
      variant={variant}
      onOpen={onOpen}
      onUse={onUse}
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
