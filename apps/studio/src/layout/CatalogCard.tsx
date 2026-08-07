import { useState } from 'react';
import { ContextMenu } from '@radix-ui/themes';
import { Check, ImageSquare } from '@phosphor-icons/react';

export type CatalogCardVariant = 'navigate' | 'use' | 'select' | 'plain';
export type CatalogCardSize = 'shelf' | 'grid' | 'slider' | 'wizard';

/**
 * The shared card shell behind `SceneCard` and `PresenterCard`
 * (docs/product/patterns/look-card.md) — same accessibility contract
 * (sibling buttons, never nested; `aria-pressed` on `select`), same visual
 * language, for both catalogs. Domain-specific wrappers map their own type
 * onto these plain string/callback props so this file never imports `Scene`
 * or `Presenter`.
 */
export function CatalogCard({
  id,
  previewUrl,
  title,
  primary,
  secondary,
  useLabel,
  variant,
  onOpen,
  onUse,
  selected,
  onToggle,
  size = 'grid',
}: {
  id: string;
  previewUrl?: string | null;
  /** Hover title on the open-button. */
  title: string;
  /** Caption's bold first line. */
  primary: string;
  /** Caption's second line. */
  secondary: string;
  /** `use` only: the fast-path button's label. */
  useLabel: string;
  variant: CatalogCardVariant;
  onOpen?: (id: string) => void;
  onUse?: (id: string) => void;
  selected?: boolean;
  onToggle?: (id: string) => void;
  size?: CatalogCardSize;
}) {
  // a broken url is the same "nothing to show" as no url at all — the blank
  // placeholder is one fallback shape for both, not two separate states
  const [broken, setBroken] = useState(false);
  const preview =
    previewUrl && !broken ? (
      <img src={previewUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
    ) : (
      <span className="sc-lookcard-blank">
        <ImageSquare size={20} />
      </span>
    );
  const caption = (
    <span className="sc-lookcard-cap">
      <b dir="auto">{primary}</b>
      <span>{secondary}</span>
    </span>
  );

  if (variant === 'select') {
    return (
      <button
        type="button"
        className="sc-lookcard"
        data-variant="select"
        data-size={size}
        data-on={selected || undefined}
        aria-pressed={!!selected}
        onClick={() => onToggle?.(id)}
      >
        {preview}
        <span className="sc-lookcard-veil" aria-hidden />
        <span className="sc-lookcard-tick" aria-hidden>
          <Check size={11} weight="bold" />
        </span>
        {caption}
      </button>
    );
  }

  const showUseButton = variant === 'use' && !!onOpen && !!onUse;
  const card = (
    <div className="sc-lookcard" data-variant={variant} data-size={size}>
      <button
        type="button"
        className="sc-lookcard-open"
        onClick={() => (onOpen ? onOpen(id) : onUse?.(id))}
        title={title}
      >
        {preview}
        <span className="sc-lookcard-veil" aria-hidden />
        {caption}
      </button>
      {showUseButton && (
        <button type="button" className="sc-lookcard-use" onClick={() => onUse?.(id)}>
          {useLabel}
        </button>
      )}
    </div>
  );
  if (!onOpen && !onUse) return card;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{card}</ContextMenu.Trigger>
      <ContextMenu.Content>
        {onOpen && <ContextMenu.Item onSelect={() => onOpen(id)}>Open</ContextMenu.Item>}
        {showUseButton && <ContextMenu.Item onSelect={() => onUse?.(id)}>{useLabel}</ContextMenu.Item>}
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}

/** One skeleton shape, every list that hasn't resolved a catalog yet. */
export function CatalogCardSkeleton({ size = 'grid', count = 4 }: { size?: CatalogCardSize; count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-count skeleton row has nothing else to key on
        <div key={i} className="sc-lookcard" data-variant="skeleton" data-size={size} aria-hidden />
      ))}
    </>
  );
}
