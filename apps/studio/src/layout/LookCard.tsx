import type { Look } from '../api.js';
import { CatalogCard, CatalogCardSkeleton, type CatalogCardSize, type CatalogCardVariant } from './CatalogCard.js';

export type LookCardVariant = CatalogCardVariant;
export type LookCardSize = CatalogCardSize;

/**
 * The one Look card, replacing six independently-drifted renderings
 * (docs/product/patterns/look-card.md). `variant` is the product decision
 * (what a click does, if anything besides opening); `size` is only density.
 * A thin adapter over `CatalogCard` — see CatalogCard.tsx for the shared
 * shell this and `PresenterCard` both render through.
 *
 * `navigate`/`use`/`plain` share one shape: an open-button wrapping the
 * preview, and — `use` only, and only when there is somewhere to open —
 * a sibling "Use this look" button. Never nested: the old `<span onClick>`
 * inside a `<button>` was the accessibility bug this replaces.
 */
export function LookCard({
  look,
  variant,
  onOpen,
  onUse,
  selected,
  onToggle,
  size = 'grid',
}: {
  look: Look;
  variant: LookCardVariant;
  /** navigate/use/plain: card body click. Omit for `use` when there is nowhere
   * left to navigate (e.g. Create's FirstRun, already on /create) — the whole
   * card becomes the `onUse` trigger instead, and no sibling button renders. */
  onOpen?: (id: string) => void;
  /** `use` only: the fast-path action, shown as a sibling button when `onOpen` is present. */
  onUse?: (id: string) => void;
  /** `select` only. */
  selected?: boolean;
  onToggle?: (id: string) => void;
  size?: LookCardSize;
}) {
  return (
    <CatalogCard
      id={look.id}
      previewUrl={look.previewUrl}
      title={look.description || look.name}
      primary={look.name}
      secondary={look.lighting}
      useLabel="Use this look"
      variant={variant}
      onOpen={onOpen}
      onUse={onUse}
      selected={selected}
      onToggle={onToggle}
      size={size}
    />
  );
}

/** One skeleton shape, every list that hasn't resolved a Look catalog yet. */
export function LookCardSkeleton(props: { size?: LookCardSize; count?: number }) {
  return <CatalogCardSkeleton {...props} />;
}
