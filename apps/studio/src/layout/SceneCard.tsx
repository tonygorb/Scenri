import type { Scene } from '../api.js';
import { sceneLabel } from '../displayName.js';
import { catalogMenuItems } from './catalogMenu.js';
import { catalogBatchItems } from './catalogPick.js';
import { CatalogCard, CatalogCardSkeleton, type CatalogCardSize, type CatalogCardVariant } from './CatalogCard.js';

export type SceneCardVariant = CatalogCardVariant;
export type SceneCardSize = CatalogCardSize;

/**
 * The one Scene card, replacing six independently-drifted renderings
 * (the shared LookCard pattern). `variant` is the product decision
 * (what a click does, if anything besides opening); `size` is only density.
 * A thin adapter over `CatalogCard` — see CatalogCard.tsx for the shared
 * shell this and `PresenterCard` both render through.
 *
 * `navigate`/`use`/`plain` share one shape: an open-button wrapping the
 * preview, and — `use` only, and only when there is somewhere to open —
 * a sibling use button. Never nested: the old `<span onClick>`
 * inside a `<button>` was the accessibility bug this replaces.
 */
export function SceneCard({
  scene,
  variant,
  onOpen,
  onUse,
  href,
  selected,
  onToggle,
  bookmarked,
  onBookmark,
  onDelete,
  onRename,
  chosen,
  batching,
  onPick,
  batch,
  size = 'grid',
}: {
  scene: Scene;
  variant: SceneCardVariant;
  /** navigate/use/plain: card body click. Omit for `use` when there is nowhere
   * left to navigate (e.g. Create's FirstRun, already on /create) — the whole
   * card becomes the `onUse` trigger instead, and no sibling button renders. */
  onOpen?: (id: string) => void;
  /** `use` only: the fast-path action, shown as a sibling button when `onOpen` is present. */
  onUse?: (id: string) => void;
  /** Forwarded to CatalogCard: the open surface's real route (see CatalogCard.href). */
  href?: string;
  /** `select` only. */
  selected?: boolean;
  onToggle?: (id: string) => void;
  /** Bookmark this scene from the card, where the browsing happens. */
  bookmarked?: boolean;
  onBookmark?: (id: string) => void;
  /** A scene you own. Opens the same delete confirm the scene page uses. */
  onDelete?: (id: string) => void;
  /** A scene you own. The same name write the scene page already saves. */
  onRename?: (id: string) => void;
  /** This card is in the wall's pick. */
  chosen?: boolean;
  /** A pick of this kind is being built, so a tap toggles instead of opening. */
  batching?: boolean;
  /** Present when this card can join the pick. */
  onPick?: (id: string) => void;
  /** Set when this card is in the pick: the right-click becomes the pick's menu. */
  batch?: { count: number; onAct: () => void; onKeep?: () => void; allKept?: boolean } | null;
  size?: SceneCardSize;
}) {
  // Home's shelf attaches the scene. There is no page behind that click, so
  // the menu is the one verb the click already performs.
  const shelf = !href && !onUse && !!onOpen;
  const menu =
    batch && onDelete
      ? catalogBatchItems({
          kind: 'owned-scene',
          count: batch.count,
          openLabel: 'Open',
          onOpen: () => onOpen?.(scene.id),
          href,
          onDeselect: () => onPick?.(scene.id),
          onAct: batch.onAct,
          onKeep: batch.onKeep,
          allKept: batch.allKept,
        })
      : shelf
        ? catalogMenuItems({ only: { label: 'Use in a shot', run: () => onOpen(scene.id) } })
        : catalogMenuItems({
            onOpen: onOpen ? () => onOpen(scene.id) : undefined,
            href,
            use: onUse ? { label: 'Use in a shot', run: () => onUse(scene.id) } : undefined,
            select: onPick ? { run: () => onPick(scene.id) } : undefined,
            keep: onBookmark ? { on: !!bookmarked, run: () => onBookmark(scene.id) } : undefined,
            onRename: onRename ? () => onRename(scene.id) : undefined,
            remove: onDelete ? { label: 'Delete scene', run: () => onDelete(scene.id) } : undefined,
          });
  return (
    <CatalogCard
      id={scene.id}
      previewUrl={scene.previewUrl}
      title={scene.description || sceneLabel(scene, 'tooltip')}
      primary={sceneLabel(scene, 'card')}
      secondary=""
      useLabel="Use in a shot"
      variant={variant}
      onOpen={onOpen}
      onUse={onUse}
      href={href}
      selected={selected}
      onToggle={onToggle}
      bookmarked={bookmarked}
      onBookmark={onBookmark}
      menu={menu}
      chosen={chosen}
      batching={batching}
      onPick={onPick}
      size={size}
    />
  );
}

/** One skeleton shape, every list that hasn't resolved a Scene catalog yet. */
export function SceneCardSkeleton(props: { size?: SceneCardSize; count?: number }) {
  return <CatalogCardSkeleton {...props} />;
}
