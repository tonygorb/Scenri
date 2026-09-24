import type { Presenter } from '../api.js';
import { catalogMenuItems } from './catalogMenu.js';
import { catalogBatchItems } from './catalogPick.js';
import { CatalogCard, CatalogCardSkeleton, type CatalogCardSize, type CatalogCardVariant } from './CatalogCard.js';

export type PresenterCardVariant = CatalogCardVariant;
export type PresenterCardSize = Exclude<CatalogCardSize, 'shelf'>;

/**
 * The one Presenter card — same variant/size split as SceneCard
 * (the shared LookCard pattern), adapted for a person rather than a
 * photographic setup: the wall shows the name, and the fast
 * path is "Use in a shot", attaching straight from the catalog exactly like
 * a Scene's own. A thin adapter over `CatalogCard` — see
 * CatalogCard.tsx for the shared shell this and `SceneCard` both render through.
 */
export function PresenterCard({
  presenter,
  variant,
  onOpen,
  onUse,
  href,
  selected,
  onToggle,
  onDuplicate,
  onEdit,
  onDelete,
  onRename,
  bookmarked,
  onBookmark,
  fresh,
  chosen,
  batching,
  onPick,
  batch,
  size = 'grid',
}: {
  presenter: Presenter;
  /** navigate/use/plain: card body click. */
  onOpen?: (id: string) => void;
  /** `use` only: the fast-path action, shown as a sibling button when `onOpen` is present. */
  onUse?: (id: string) => void;
  /** Forwarded to CatalogCard: the open surface's real route (see CatalogCard.href). */
  href?: string;
  /** `select` only. */
  selected?: boolean;
  onToggle?: (id: string) => void;
  /** Owned saved cards only: opens the duplicate-name dialog. */
  onDuplicate?: (id: string) => void;
  /** Owned saved cards only: the edit route the presenter page already links. */
  onEdit?: (id: string) => void;
  /** Owned saved cards only: opens the existing delete confirm. */
  onDelete?: (id: string) => void;
  /** Owned saved cards only: the same name write the details dialog already saves. */
  onRename?: (id: string) => void;
  /** Kept. The gold star, and the menu line that toggles it. */
  bookmarked?: boolean;
  onBookmark?: (id: string) => void;
  /** The card that just landed from a duplicate, so the wall can mark it. */
  fresh?: boolean;
  chosen?: boolean;
  batching?: boolean;
  onPick?: (id: string) => void;
  /** Set when this card is in the pick: the right-click becomes the pick's menu. */
  batch?: { count: number; onAct: () => void; onKeep?: () => void; allKept?: boolean } | null;
  variant: PresenterCardVariant;
  size?: PresenterCardSize;
}) {
  const shelf = !href && !onUse && !!onOpen;
  const menu = batch
    ? catalogBatchItems({
        kind: 'presenter',
        count: batch.count,
        openLabel: 'Open',
        onOpen: () => onOpen?.(presenter.id),
        href,
        onDeselect: () => onPick?.(presenter.id),
        onAct: batch.onAct,
        onKeep: batch.onKeep,
        allKept: batch.allKept,
      })
    : shelf
      ? catalogMenuItems({ only: { label: 'Use in a shot', run: () => onOpen(presenter.id) } })
      : catalogMenuItems({
          onOpen: onOpen ? () => onOpen(presenter.id) : undefined,
          href,
          use: onUse ? { label: 'Use in a shot', run: () => onUse(presenter.id) } : undefined,
          select: onPick ? { run: () => onPick(presenter.id) } : undefined,
          keep: onBookmark ? { on: !!bookmarked, run: () => onBookmark(presenter.id) } : undefined,
          onRename: onRename ? () => onRename(presenter.id) : undefined,
          onDuplicate: onDuplicate ? () => onDuplicate(presenter.id) : undefined,
          onEdit: onEdit ? () => onEdit(presenter.id) : undefined,
          remove: onDelete ? { label: 'Delete presenter', run: () => onDelete(presenter.id) } : undefined,
        });
  return (
    <CatalogCard
      id={presenter.id}
      previewUrl={presenter.previewUrl}
      title={presenter.descriptor || presenter.name}
      primary={presenter.name}
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
      fresh={fresh}
      chosen={chosen}
      batching={batching}
      onPick={onPick}
      size={size}
    />
  );
}

/** One skeleton shape, every list that hasn't resolved the Presenter catalog yet. */
export function PresenterCardSkeleton(props: { size?: PresenterCardSize; count?: number }) {
  return <CatalogCardSkeleton {...props} />;
}
