import type { ShowcaseEntry } from '../api.js';
import { CatalogCard, CatalogCardSkeleton, type CatalogCardSize } from './CatalogCard.js';

export type ShowcaseCardSize = CatalogCardSize;

/**
 * One showcase tile: the generated hero image a real product+presenter+scene
 * recipe produced, not a bare lighting swatch. A thin adapter over
 * `CatalogCard` — see CatalogCard.tsx for the shared shell this, `SceneCard`
 * and `PresenterCard` all render through.
 *
 * `onOpen` doubles as both the whole-card click and the hover-revealed
 * "Recreate this" pill (always `variant="use"` with the same handler for
 * both — no separate `variant` prop, unlike the other cards) — a showcase
 * tile has no separate detail page the way a Scene or Presenter does, so
 * open and use are the same action. The caption's second line names the
 * recipe (product, presenter if any, scene) rather than a category, so
 * hovering tells you what's actually in the shot before you click through.
 * A presenter-led shot also gets a small always-visible avatar badge, the
 * same way a cast credit reads on a real campaign board. It rides top-left,
 * clear of the hover caption that fills the bottom edge.
 */
export function ShowcaseCard({
  entry,
  productName,
  presenterName,
  presenterPreviewUrl,
  sceneName,
  onOpen,
  size = 'grid',
}: {
  entry: ShowcaseEntry;
  /** Resolved from the entry's own product token — a showcase product is always a demo product. */
  productName?: string | null;
  presenterName?: string | null;
  presenterPreviewUrl?: string | null;
  sceneName?: string | null;
  onOpen?: (id: string) => void;
  size?: ShowcaseCardSize;
}) {
  const recipe = [productName, presenterName, sceneName].filter(Boolean).join(' · ');
  return (
    <div className="sc-showcase-tile">
      <CatalogCard
        id={entry.id}
        previewUrl={entry.previewUrl}
        title={entry.title}
        primary={entry.title}
        secondary={recipe}
        useLabel="Recreate this"
        variant="use"
        onOpen={onOpen}
        onUse={onOpen}
        size={size}
      />
      {presenterName && (
        <span className="sc-showcase-badge" aria-hidden>
          {presenterPreviewUrl ? <img src={presenterPreviewUrl} alt="" /> : null}
          {presenterName}
        </span>
      )}
    </div>
  );
}

/** One skeleton shape, every list that hasn't resolved the showcase gallery yet. */
export function ShowcaseCardSkeleton(props: { size?: ShowcaseCardSize; count?: number }) {
  return <CatalogCardSkeleton {...props} />;
}
