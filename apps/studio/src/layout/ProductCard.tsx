import { memo, useMemo } from 'react';
import { assetUrl, type Product } from '../api.js';
import { productLabel } from '../displayName.js';
import { catalogMenuItems } from './catalogMenu.js';
import { catalogBatchItems } from './catalogPick.js';
import { CatalogCard, CatalogCardSkeleton, type CatalogCardSize, type CatalogCardVariant } from './CatalogCard.js';

export type ProductCardVariant = CatalogCardVariant;
export type ProductCardSize = CatalogCardSize;

/**
 * The one Product card — same variant/size split as SceneCard/PresenterCard
 * (the shared LookCard pattern): the wall shows the name. Category and
 * variant stay on the product itself. The fast path is "Use in a shot".
 * A thin adapter over `CatalogCard`.
 */
function ProductCardInner({
  product,
  variant,
  onOpen,
  onUse,
  href,
  selected,
  onToggle,
  onDelete,
  onRename,
  bookmarked,
  onBookmark,
  chosen,
  batching,
  onPick,
  batch,
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
  /** A product you own. Opens the same delete confirm the product page uses. */
  onDelete?: (id: string) => void;
  /** A product you made. The same name write the product page already saves. */
  onRename?: (id: string) => void;
  bookmarked?: boolean;
  onBookmark?: (id: string) => void;
  chosen?: boolean;
  batching?: boolean;
  onPick?: (id: string) => void;
  /** Set when this card is in the pick: the right-click becomes the pick's menu. */
  batch?: { count: number; onAct: () => void; onKeep?: () => void; allKept?: boolean } | null;
  variant: ProductCardVariant;
  size?: ProductCardSize;
}) {
  const menu = useMemo(
    () =>
      batch
        ? catalogBatchItems({
            kind: 'product',
            count: batch.count,
            openLabel: 'Open',
            onOpen: () => onOpen?.(product.id),
            href,
            onDeselect: () => onPick?.(product.id),
            onAct: batch.onAct,
            onKeep: batch.onKeep,
            allKept: batch.allKept,
          })
        : catalogMenuItems({
            onOpen: onOpen ? () => onOpen(product.id) : undefined,
            href,
            use: onUse ? { label: 'Use in a shot', run: () => onUse(product.id) } : undefined,
            select: onPick ? { run: () => onPick(product.id) } : undefined,
            keep: onBookmark ? { on: !!bookmarked, run: () => onBookmark(product.id) } : undefined,
            onRename: onRename ? () => onRename(product.id) : undefined,
            remove: onDelete ? { label: 'Delete product', run: () => onDelete(product.id) } : undefined,
          }),
    [onOpen, onUse, onDelete, onRename, onPick, onBookmark, bookmarked, href, product.id, batch],
  );
  return (
    <CatalogCard
      id={product.id}
      previewUrl={assetUrl(product.shots?.[0]?.file)}
      title={productLabel(product, 'tooltip')}
      primary={productLabel(product, 'card')}
      secondary=""
      useLabel="Use in a shot"
      variant={variant}
      onOpen={onOpen}
      onUse={onUse}
      href={href}
      selected={selected}
      onToggle={onToggle}
      menu={menu}
      bookmarked={bookmarked}
      onBookmark={onBookmark}
      chosen={chosen}
      batching={batching}
      onPick={onPick}
      size={size}
    />
  );
}

/** One skeleton shape, every list that hasn't resolved the product library yet. */
export function ProductCardSkeleton(props: { size?: ProductCardSize; count?: number }) {
  return <CatalogCardSkeleton {...props} />;
}

/**
 * Memoised: nothing here re-renders unless its own props change.
 * A wall of these re-rendered in full on every Products render, and during
 * an import that was every 1.5 seconds.
 */
export const ProductCard = memo(ProductCardInner);
