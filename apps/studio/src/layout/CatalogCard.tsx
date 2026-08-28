import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ContextMenu } from '@radix-ui/themes';
import { BookmarkSimple, Check, ImageSquare } from '@phosphor-icons/react';

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
  href,
  selected,
  onToggle,
  bookmarked,
  onBookmark,
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
  /**
   * The open surface's real route, opt-in. Present: the open target renders as
   * a Link, so middle click, Cmd click and copy-link behave like the web while
   * a plain click still SPA-navigates; `onOpen` is then NOT called on click
   * (the Link already navigates) and remains only the context menu's Open.
   * Absent: the open target stays a button. Callers whose `onOpen` applies the
   * card to the brief rather than navigating (the Home shelves) pass no href.
   */
  href?: string;
  selected?: boolean;
  onToggle?: (id: string) => void;
  /**
   * Optional bookmark, shown on the media in every variant but `select`.
   *
   * Shortlisting used to happen once, in a setup wizard, which is the wrong
   * moment for it — you decide while browsing, on the card in front of you.
   *
   * A bookmark, not a star: a filled gold star already means a kept shot, and
   * one glyph cannot mean two things in one app.
   */
  bookmarked?: boolean;
  onBookmark?: (id: string) => void;
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
        {href ? (
          <Link
            className="sc-lookcard-open"
            to={href}
            aria-label={title}
            onClick={(e) => {
              // Touch: first tap ≈ hover (reveal Use); second tap follows the
              // link. The arming tap must not navigate, so it is the one case
              // where the anchor's default is suppressed.
              if (showUseButton && touchUi) {
                if (!armed) {
                  e.preventDefault();
                  setArmed(true);
                  return;
                }
                setArmed(false);
              }
            }}
          >
            {preview}
            <span className="sc-lookcard-veil" aria-hidden />
          </Link>
        ) : (
          <button type="button" className="sc-lookcard-open" onClick={handleOpen} aria-label={title}>
            {preview}
            <span className="sc-lookcard-veil" aria-hidden />
          </button>
        )}
        {showUseButton && (
          <button type="button" className="sc-lookcard-use" onClick={handleUse}>
            {useLabel}
          </button>
        )}
        {onBookmark && (
          <button
            type="button"
            className="sc-cardpuck sc-lookcard-bookmark"
            data-on={bookmarked || undefined}
            aria-pressed={!!bookmarked}
            aria-label={bookmarked ? `Remove bookmark from ${primary}` : `Bookmark ${primary}`}
            onClick={(e) => {
              // The media is an open-button; a bookmark inside it must not open.
              e.stopPropagation();
              onBookmark(id);
            }}
          >
            <BookmarkSimple size={13} weight={bookmarked ? 'fill' : 'regular'} />
          </button>
        )}
      </div>
      {caption}
    </div>
  );

  if (!onOpen && !onUse && !href) return card;
  if (touchUi) return card;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{card}</ContextMenu.Trigger>
      <ContextMenu.Content>
        {onOpen && <ContextMenu.Item onSelect={() => onOpen(id)}>Open</ContextMenu.Item>}
        {/* Radix swallows the native contextmenu, so the browser's own "Open
            link in new tab" can never appear on a card; this item stands in
            for it. Middle click and Cmd click reach the anchor natively. */}
        {href && <ContextMenu.Item onSelect={() => window.open(href, '_blank')}>Open in new tab</ContextMenu.Item>}
        {showUseButton && <ContextMenu.Item onSelect={() => onUse?.(id)}>{useLabel}</ContextMenu.Item>}
        {onBookmark && (
          <ContextMenu.Item onSelect={() => onBookmark(id)}>
            {bookmarked ? 'Remove bookmark' : 'Bookmark'}
          </ContextMenu.Item>
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
