import type { Scene } from '../api.js';
import { sceneLabel } from '../displayName.js';
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
  selected,
  onToggle,
  bookmarked,
  onBookmark,
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
  /** `select` only. */
  selected?: boolean;
  onToggle?: (id: string) => void;
  /** Bookmark this scene from the card, where the browsing happens. */
  bookmarked?: boolean;
  onBookmark?: (id: string) => void;
  size?: SceneCardSize;
}) {
  return (
    <CatalogCard
      id={scene.id}
      previewUrl={scene.previewUrl}
      title={scene.description || sceneLabel(scene, 'tooltip')}
      primary={sceneLabel(scene, 'card')}
      secondary={scene.lighting}
      useLabel="Use in a shot"
      variant={variant}
      onOpen={onOpen}
      onUse={onUse}
      selected={selected}
      onToggle={onToggle}
      bookmarked={bookmarked}
      onBookmark={onBookmark}
      size={size}
    />
  );
}

/** One skeleton shape, every list that hasn't resolved a Scene catalog yet. */
export function SceneCardSkeleton(props: { size?: SceneCardSize; count?: number }) {
  return <CatalogCardSkeleton {...props} />;
}
