import { memo, useEffect, useRef, useState, type ReactElement } from 'react';
import { CARD_SIZES, thumbOf, tileSrcSet } from '../api.js';
import { useHoverNone } from '../useMediaQuery.js';
import { Link } from 'react-router';
import { ContextMenu, DropdownMenu } from '@radix-ui/themes';
import { Check, DotsThree, DotsThreeVertical, ImageSquare, Star, Trash } from '@phosphor-icons/react';
import type { CatalogMenuItem } from './catalogMenu.js';
import { useWallDensitySize } from './DensityControl.js';
import { MenuGlyph } from './menuGlyph.js';
import { Shown } from './ReferenceGallery.js';
import { iconTip } from './Tip.js';

export type CatalogCardVariant = 'navigate' | 'use' | 'select' | 'plain';
export type CatalogCardSize = 'shelf' | 'grid' | 'slider' | 'wizard';
export type { CatalogMenuItem };

type MenuItem = typeof ContextMenu.Item;
type MenuSeparator = typeof ContextMenu.Separator;

/** Both Radix families draw the same lines. A second copy of the words is how the two menus drift. */
function drawMenu(items: CatalogMenuItem[], Item: MenuItem, Separator: MenuSeparator) {
  return items.map((it) => (
    <span key={it.key} style={{ display: 'contents' }}>
      {it.separated && <Separator />}
      <Item color={it.danger ? 'red' : undefined} onSelect={it.onSelect}>
        <MenuGlyph name={it.icon} />
        {it.label}
      </Item>
    </span>
  ));
}

/**
 * Shared card shell for Scene / Presenter / Showcase / etc.
 *
 * Structure:
 *   .sc-lookcard
 *     .sc-lookcard-media   ← image plane; use-pill centers here
 *       .sc-lookcard-open  ← click/tap → detail (or arm on touch)
 *       .sc-lookcard-use   ← hover / first-tap → create
 *     .sc-lookcard-cap     ← overlay on desktop, footer on touch.
                            A showcase tile keeps it on the picture.
 *
 * Desktop: hover reveals veil + caption + centered use. Touch: title
 * footer under the image; first tap arms (shows use like hover); pill →
 * create; second tap on image → detail. The menu is built by the caller
 * and drawn here twice: a right-click on desktop, and a corner overflow
 * when the list has a verb the card face does not already show.
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
  menu,
  fresh,
  size = 'grid',
  chosen,
  batching,
  onPick,
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
  /** Kept. The corner star toggles it. */
  bookmarked?: boolean;
  onBookmark?: (id: string) => void;
  /**
   * The card's menu, built once by `catalogMenuItems`. Drawn by the
   * right-click and, when it holds a verb the card face does not, the overflow.
   */
  menu?: CatalogMenuItem[];
  /** Just arrived (a duplicate). Reveals the caption and a short arrival. */
  fresh?: boolean;
  size?: CatalogCardSize;
  /** This card is in the wall's pick. Draws the ring and the lit tick. */
  chosen?: boolean;
  /**
   * A pick of this card's kind is being built. A tap toggles instead of
   * opening. The corner actions stay: they are this card's, and the dock
   * is the batch's.
   */
  batching?: boolean;
  /** Present on a card that has a bulk verb. The tick, and the tap while a pick exists. */
  onPick?: (id: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const touchUi = useHoverNone();
  // the column this card sits in, so its picture is fetched once at the width shown
  const density = useWallDensitySize();
  const named = (label: string, control: ReactElement) => iconTip(label, control, touchUi);

  const showUseButton = variant === 'use' && !!onOpen && !!onUse && !batching;
  const lines = menu ?? [];
  const remove = lines.find((it) => it.key === 'delete');
  const showMore = lines.length > 0;
  const pick = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault();
    e.stopPropagation();
    onPick?.(id);
  };

  useEffect(() => {
    if (!armed) return;
    const onPointerDown = (e: PointerEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return;
      setArmed(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [armed]);

  // A picture that exists paints through Shown: its place held on the card's
  // ground, faded in once decoded, painted at once if this session has seen
  // it. A picture on its way (library imagery still arriving, a store product
  // whose details are still coming) holds the same 4:5 box, still, with no
  // glyph: a waiting card is not a broken one. Only a card with nothing
  // coming shows the glyph.
  const preview = previewUrl ? (
    <Shown
      src={thumbOf(previewUrl, 'tile')}
      srcSet={tileSrcSet(previewUrl)}
      sizes={CARD_SIZES[density]}
      wait
      blank="sc-lookcard-blank"
    />
  ) : pending ? (
    <span className="sc-lookcard-blank" data-waiting>
      <span className="sc-placeholder" />
    </span>
  ) : (
    <span className="sc-lookcard-blank">
      <ImageSquare size={20} />
    </span>
  );

  // `title` was reaching the DOM only as an aria-label, so a sighted user had
  // no way to read a name the caption had ellipsised. The caption is what
  // clips, so the caption is what carries the full text.
  const stop = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const more = showMore ? (
    <DropdownMenu.Root>
      {named(
        'More',
        <DropdownMenu.Trigger>
          <button
            type="button"
            className="sc-cell-ctl sc-lookcard-more"
            aria-label={`More for ${primary}`}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
          >
            <DotsThreeVertical className="sc-lookcard-more-vert" size={16} weight="bold" />
            <DotsThree className="sc-lookcard-more-horiz" size={16} weight="bold" />
          </button>
        </DropdownMenu.Trigger>,
      )}
      <DropdownMenu.Content side="top" align="end" sideOffset={4} collisionPadding={12}>
        {drawMenu(lines, DropdownMenu.Item, DropdownMenu.Separator)}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  ) : null;
  const corner =
    more || remove || onBookmark ? (
      <div className="sc-corner">
        {more}
        {remove &&
          named(
            remove.label,
            <button
              type="button"
              className="sc-cell-ctl sc-lookcard-remove sc-cell-danger"
              aria-label={remove.label}
              onClick={(e) => {
                stop(e);
                remove.onSelect();
              }}
            >
              <Trash size={15} />
            </button>,
          )}
        {onBookmark &&
          named(
            bookmarked ? 'Remove from Keepers' : 'Add to Keepers',
            <button
              type="button"
              className="sc-cell-ctl sc-lookcard-keep"
              data-on={bookmarked || undefined}
              aria-pressed={!!bookmarked}
              aria-label={bookmarked ? `Remove ${primary} from Keepers` : `Add ${primary} to Keepers`}
              onClick={(e) => {
                stop(e);
                onBookmark(id);
              }}
            >
              <Star size={15} weight={bookmarked ? 'fill' : 'regular'} />
            </button>,
          )}
      </div>
    ) : null;
  const caption = (
    <span className="sc-lookcard-cap" title={title}>
      <span className="sc-lookcard-copy">
        <b dir="auto">{primary}</b>
        {secondary && <span>{secondary}</span>}
      </span>
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
    if (batching && onPick) {
      onPick(id);
      return;
    }
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
      data-picked={chosen || undefined}
      data-batching={batching || undefined}
    >
      <div className="sc-lookcard-media">
        {href ? (
          <Link
            className="sc-lookcard-open"
            to={href}
            aria-label={batching ? `${chosen ? 'Deselect' : 'Select'} ${primary}` : title}
            onClick={(e) => {
              if (batching && onPick) {
                pick(e);
                return;
              }
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
            {!batching && <span className="sc-lookcard-veil" aria-hidden />}
          </Link>
        ) : (
          <button
            type="button"
            className="sc-lookcard-open"
            onClick={handleOpen}
            aria-label={batching ? `${chosen ? 'Deselect' : 'Select'} ${primary}` : title}
          >
            {preview}
            {!batching && <span className="sc-lookcard-veil" aria-hidden />}
          </button>
        )}
        {showUseButton && (
          <button type="button" className="sc-lookcard-use" onClick={handleUse}>
            {useLabel}
          </button>
        )}
        {onPick &&
          named(
            chosen ? 'Deselect' : 'Select',
            <button
              type="button"
              className="sc-cell-ctl sc-lookcard-pick"
              data-on={chosen || undefined}
              aria-pressed={!!chosen}
              aria-label={chosen ? `Deselect ${primary}` : `Select ${primary}`}
              onClick={pick}
            >
              <Check size={13} weight="bold" />
            </button>,
          )}
      </div>
      {corner}
      {caption}
    </div>
  );

  if (lines.length === 0) return card;
  if (touchUi) return card;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{card}</ContextMenu.Trigger>
      <ContextMenu.Content>{drawMenu(lines, ContextMenu.Item, ContextMenu.Separator)}</ContextMenu.Content>
    </ContextMenu.Root>
  );
}

export function CatalogCardSkeleton({
  size = 'grid',
  count = 4,
  caption = true,
}: {
  size?: CatalogCardSize;
  count?: number;
  /** Home's examples carry the name on the picture, so the placeholder is the photo alone. */
  caption?: boolean;
}) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-count skeleton row has nothing else to key on
          key={i}
          className="sc-lookcard sc-wait-late"
          data-variant="skeleton"
          data-size={size}
          data-caption={caption ? undefined : 'photo'}
          aria-hidden
        />
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
