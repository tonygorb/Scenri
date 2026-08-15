import { useEffect, useRef, useState } from 'react';
import { ContextMenu } from '@radix-ui/themes';
import { Check, ImageSquare, Star } from '@phosphor-icons/react';

export type CatalogCardVariant = 'navigate' | 'use' | 'select' | 'plain';
export type CatalogCardSize = 'shelf' | 'grid' | 'slider' | 'wizard';

/**
 * Shared card shell for Scene / Presenter / Showcase / etc.
 *
 * Structure:
 *   .sc-lookcard
 *     .sc-lookcard-media   ← image plane; use-pill centers here
 *       .sc-lookcard-open  ← click/tap → detail (or arm on touch)
 *       .sc-lookcard-use   ← hover / first-tap → create
 *     .sc-lookcard-cap     ← overlay on desktop, footer on touch
 *
 * Desktop: hover reveals veil + caption + centered use. Touch: title
 * footer under the image; first tap arms (shows use like hover); pill →
 * create; second tap on image → detail. Context menu is desktop-only.
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
  starred,
  onStar,
  size = 'grid',
}: {
  id: string;
  previewUrl?: string | null;
  title: string;
  primary: string;
  secondary: string;
  useLabel: string;
  variant: CatalogCardVariant;
  onOpen?: (id: string) => void;
  onUse?: (id: string) => void;
  selected?: boolean;
  onToggle?: (id: string) => void;
  /**
   * Optional star, shown on the media in every variant but `select`.
   *
   * Favouriting used to happen once, in a setup wizard, which is the wrong
   * moment for a judgement about taste — you make it while browsing, on the
   * card in front of you.
   */
  starred?: boolean;
  onStar?: (id: string) => void;
  size?: CatalogCardSize;
}) {
  const [broken, setBroken] = useState(false);
  const [armed, setArmed] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [touchUi, setTouchUi] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(hover: none)');
    const sync = () => setTouchUi(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const showUseButton = variant === 'use' && !!onOpen && !!onUse;

  useEffect(() => {
    if (!armed) return;
    const onPointerDown = (e: PointerEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return;
      setArmed(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [armed]);

  const preview =
    previewUrl && !broken ? (
      <img src={previewUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
    ) : (
      <span className="sc-lookcard-blank">
        <ImageSquare size={20} />
      </span>
    );

  // `title` was reaching the DOM only as an aria-label, so a sighted user had
  // no way to read a name the caption had ellipsised. The caption is what
  // clips, so the caption is what carries the full text.
  const caption = (
    <span className="sc-lookcard-cap" title={title}>
      <b dir="auto">{primary}</b>
      {secondary && <span>{secondary}</span>}
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
        aria-label={title}
        onClick={() => onToggle?.(id)}
      >
        <span className="sc-lookcard-media">
          {preview}
          <span className="sc-lookcard-veil" aria-hidden />
          <span className="sc-lookcard-tick" aria-hidden>
            <Check size={11} weight="bold" />
          </span>
        </span>
        {caption}
      </button>
    );
  }

  const handleOpen = () => {
    // Touch: first tap ≈ hover (reveal Use); second tap opens detail.
    if (showUseButton && touchUi) {
      if (!armed) {
        setArmed(true);
        return;
      }
      setArmed(false);
    }
    if (onOpen) onOpen(id);
    else onUse?.(id);
  };

  const handleUse = () => {
    setArmed(false);
    onUse?.(id);
  };

  const card = (
    <div
      ref={cardRef}
      className="sc-lookcard"
      data-fb="catalog-card"
      data-fb-id={id}
      data-variant={variant}
      data-size={size}
      data-armed={armed || undefined}
    >
      <div className="sc-lookcard-media">
        <button type="button" className="sc-lookcard-open" onClick={handleOpen} aria-label={title}>
          {preview}
          <span className="sc-lookcard-veil" aria-hidden />
        </button>
        {showUseButton && (
          <button type="button" className="sc-lookcard-use" onClick={handleUse}>
            {useLabel}
          </button>
        )}
        {onStar && (
          <button
            type="button"
            className="sc-lookcard-star"
            data-on={starred || undefined}
            aria-pressed={!!starred}
            aria-label={starred ? `Unstar ${primary}` : `Star ${primary}`}
            onClick={(e) => {
              // The media is an open-button; a star inside it must not open.
              e.stopPropagation();
              onStar(id);
            }}
          >
            <Star size={13} weight={starred ? 'fill' : 'regular'} />
          </button>
        )}
      </div>
      {caption}
    </div>
  );

  if (!onOpen && !onUse) return card;
  if (touchUi) return card;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{card}</ContextMenu.Trigger>
      <ContextMenu.Content>
        {onOpen && <ContextMenu.Item onSelect={() => onOpen(id)}>Open</ContextMenu.Item>}
        {showUseButton && <ContextMenu.Item onSelect={() => onUse?.(id)}>{useLabel}</ContextMenu.Item>}
        {onStar && <ContextMenu.Item onSelect={() => onStar(id)}>{starred ? 'Remove star' : 'Star'}</ContextMenu.Item>}
        {/* Alpha builds only, and an event rather than an import. */}
        {__SC_ALPHA__ && (
          <>
            <ContextMenu.Separator />
            <ContextMenu.Item
              onSelect={() => window.dispatchEvent(new CustomEvent('scenri:feedback', { detail: { fbId: id } }))}
            >
              Report this
            </ContextMenu.Item>
          </>
        )}
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}

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
