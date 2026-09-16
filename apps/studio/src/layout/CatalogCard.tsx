import { memo, useEffect, useRef, useState } from 'react';
import { thumbOf } from '../api.js';
import { useHoverNone } from '../useMediaQuery.js';
import { Link } from 'react-router';
import { ContextMenu, DropdownMenu } from '@radix-ui/themes';
import { BookmarkSimple, Check, DotsThree, ImageSquare } from '@phosphor-icons/react';

export type CatalogCardVariant = 'navigate' | 'use' | 'select' | 'plain';
export type CatalogCardSize = 'shelf' | 'grid' | 'slider' | 'wizard';

/** Extra verbs a card may offer, after Open / Use. Delete sits last and red. */
export type CatalogMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  separated?: boolean;
};

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
 * create; second tap on image → detail. Context menu is desktop-only;
 * owned cards also get a corner overflow for keyboard and touch.
 */
function CatalogCardInner({
  id,
  previewUrl,
  pending,
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
  menuItems,
  fresh,
  size = 'grid',
}: {
  id: string;
  previewUrl?: string | null;
  /**
   * The picture is on its way, rather than absent.
   *
   * Without this a card waiting on its details showed the same empty-frame
   * glyph as a product that genuinely has no picture, so a whole grid mid-load
   * read as a grid of broken products.
   */
  pending?: boolean;
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
  /** Management verbs after Open / Use. Absent on catalog and draft cards. */
  menuItems?: CatalogMenuItem[];
  /** Just arrived (a duplicate). Reveals the caption and a short arrival. */
  fresh?: boolean;
  size?: CatalogCardSize;
}) {
  const [broken, setBroken] = useState(false);
  const [armed, setArmed] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const touchUi = useHoverNone();

  const showUseButton = variant === 'use' && !!onOpen && !!onUse;
  const extras = menuItems ?? [];

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
      <img src={thumbOf(previewUrl, 'tile')} alt="" loading="lazy" onError={() => setBroken(true)} />
    ) : pending ? (
      <span className="sc-shimmer" />
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
        data-fb-id={id}
        data-variant="select"
        data-size={size}
        data-on={selected || undefined}
        data-just-added={fresh || undefined}
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
      data-just-added={fresh || undefined}
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
        {extras.length > 0 && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <button
                type="button"
                className="sc-cardpuck sc-lookcard-more"
                aria-label={`More for ${primary}`}
                onClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.stopPropagation()}
              >
                <DotsThree size={16} weight="bold" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" sideOffset={6}>
              {onOpen && <DropdownMenu.Item onSelect={() => onOpen(id)}>Open</DropdownMenu.Item>}
              {href && (
                <DropdownMenu.Item onSelect={() => window.open(href, '_blank')}>Open in new tab</DropdownMenu.Item>
              )}
              {showUseButton && <DropdownMenu.Item onSelect={() => onUse?.(id)}>{useLabel}</DropdownMenu.Item>}
              {onBookmark && (
                <DropdownMenu.Item onSelect={() => onBookmark(id)}>
                  {bookmarked ? 'Remove bookmark' : 'Bookmark'}
                </DropdownMenu.Item>
              )}
              {extras.map((it) => (
                <span key={it.key} style={{ display: 'contents' }}>
                  {it.separated && <DropdownMenu.Separator />}
                  <DropdownMenu.Item color={it.danger ? 'red' : undefined} onSelect={it.onSelect}>
                    {it.label}
                  </DropdownMenu.Item>
                </span>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        )}
      </div>
      {caption}
    </div>
  );

  if (!onOpen && !onUse && !href && extras.length === 0) return card;
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
        {extras.map((it) => (
          <span key={it.key} style={{ display: 'contents' }}>
            {it.separated && <ContextMenu.Separator />}
            <ContextMenu.Item color={it.danger ? 'red' : undefined} onSelect={it.onSelect}>
              {it.label}
            </ContextMenu.Item>
          </span>
        ))}
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

/**
 * Memoised: nothing here re-renders unless its own props change.
 * A wall of these re-rendered in full on every Products render, and during
 * an import that was every 1.5 seconds.
 */
export const CatalogCard = memo(CatalogCardInner);
