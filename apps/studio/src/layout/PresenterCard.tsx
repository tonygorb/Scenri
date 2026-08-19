import type { Presenter } from '../api.js';
import { CatalogCard, CatalogCardSkeleton, type CatalogCardSize, type CatalogCardVariant } from './CatalogCard.js';

export type PresenterCardVariant = CatalogCardVariant;
export type PresenterCardSize = Exclude<CatalogCardSize, 'shelf'>;

/**
 * The one Presenter card — same variant/size split as SceneCard
 * (the shared LookCard pattern), adapted for a person rather than a
 * photographic setup: the caption is name + casting descriptor, and the fast
 * path is "Use in a shot", attaching straight from the catalog exactly like
 * a Scene's own. A thin adapter over `CatalogCard` — see
 * CatalogCard.tsx for the shared shell this and `SceneCard` both render through.
 */
export function PresenterCard({
  presenter,
  variant,
  onOpen,
  onUse,
  selected,
  onToggle,
  size = 'grid',
}: {
  presenter: Presenter;
  /** navigate/use/plain: card body click. */
  onOpen?: (id: string) => void;
  /** `use` only: the fast-path action, shown as a sibling button when `onOpen` is present. */
  onUse?: (id: string) => void;
  /** `select` only. */
  selected?: boolean;
  onToggle?: (id: string) => void;
  variant: PresenterCardVariant;
  size?: PresenterCardSize;
}) {
  return (
    <CatalogCard
      id={presenter.id}
      previewUrl={presenter.previewUrl}
      title={presenter.descriptor || presenter.name}
      primary={presenter.name}
      secondary={presenter.descriptor}
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

/** One skeleton shape, every list that hasn't resolved the Presenter catalog yet. */
export function PresenterCardSkeleton(props: { size?: PresenterCardSize; count?: number }) {
  return <CatalogCardSkeleton {...props} />;
}
