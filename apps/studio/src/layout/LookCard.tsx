import { useState } from 'react';
import { ContextMenu } from '@radix-ui/themes';
import { Check, ImageSquare } from '@phosphor-icons/react';
import type { Look } from '../api.js';

export type LookCardVariant = 'navigate' | 'use' | 'select' | 'plain';
export type LookCardSize = 'shelf' | 'grid' | 'slider' | 'wizard';

/**
 * The one Look card, replacing six independently-drifted renderings
 * (docs/product/patterns/look-card.md). `variant` is the product decision
 * (what a click does, if anything besides opening); `size` is only density.
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
  // a broken url is the same "nothing to show" as no url at all — the blank
  // placeholder is one fallback shape for both, not two separate states
  const [broken, setBroken] = useState(false);
  // the caption always says the name too, right below — an alt text repeating
  // it would just be the same announcement twice for a screen reader
  const preview =
    look.previewUrl && !broken ? (
      <img src={look.previewUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
    ) : (
      <span className="sc-lookcard-blank">
        <ImageSquare size={20} />
      </span>
    );
  const caption = (
    <span className="sc-lookcard-cap">
      <b dir="auto">{look.name}</b>
      <span>{look.lighting}</span>
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
        onClick={() => onToggle?.(look.id)}
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
        onClick={() => (onOpen ? onOpen(look.id) : onUse?.(look.id))}
        title={look.description || look.name}
      >
        {preview}
        <span className="sc-lookcard-veil" aria-hidden />
        {caption}
      </button>
      {showUseButton && (
        <button type="button" className="sc-lookcard-use" onClick={() => onUse?.(look.id)}>
          Use this look
        </button>
      )}
    </div>
  );
  if (!onOpen && !onUse) return card;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{card}</ContextMenu.Trigger>
      <ContextMenu.Content>
        {onOpen && <ContextMenu.Item onSelect={() => onOpen(look.id)}>Open</ContextMenu.Item>}
        {showUseButton && <ContextMenu.Item onSelect={() => onUse?.(look.id)}>Use this look</ContextMenu.Item>}
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}

/** One skeleton shape, every list that hasn't resolved a Look catalog yet. */
export function LookCardSkeleton({ size = 'grid', count = 4 }: { size?: LookCardSize; count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-count skeleton row has nothing else to key on
        <div key={i} className="sc-lookcard" data-variant="skeleton" data-size={size} aria-hidden />
      ))}
    </>
  );
}
