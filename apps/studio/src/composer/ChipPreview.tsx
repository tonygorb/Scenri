import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImageSquare } from '@phosphor-icons/react';
import { PREVIEW_W, placePanel, type Placed } from './anchorPanel.js';

/**
 * The picture a chip is holding, shown beside the chip on hover.
 *
 * Scenri already had this pattern once: `CreditTip` on a showcase tile is a
 * portaled card of image, name and role that opens when a credit is hovered.
 * This is that idea where a brief chip needs it, so hovering to peek and
 * clicking to open is one behaviour in two places rather than two.
 *
 * Anchored and portaled the way `PickerPanel` is, and for the same reason: a
 * brief chip is a DOM node the line owns, so there is no React element for a
 * Radix popover to hang off.
 *
 * It takes no focus, so Escape is caught on `window` the way TokenMenu catches
 * it — there is nothing inside this card for a key to reach.
 */

/** Every surface whose identity is an image: a brief-line chip, a shot-record
   chip, or a version frame in the detail panel. */
const PREVIEW_KINDS = ['ref', 'mark', 'product', 'presenter', 'scene', 'shot'] as const;
export type PreviewKind = (typeof PREVIEW_KINDS)[number];

/**
 * The carried strip maps compiler roles to kinds and passes anything it does
 * not recognise straight through, so the two kinds with no picture worth
 * showing on their own — composition and style — are filtered here rather than
 * given a card with no noun.
 */
export const isPreviewKind = (k: string): k is PreviewKind => (PREVIEW_KINDS as readonly string[]).includes(k);

/** What the card calls it, in its second line and in the label it reads out. */
export const PREVIEW_NOUN: Record<PreviewKind, string> = {
  ref: 'Reference image',
  mark: 'Brand mark',
  product: 'Product',
  presenter: 'Presenter',
  scene: 'Scene',
  shot: 'Version',
};

/**
 * `placePanel` anchors a panel by its TOP and hands back the height it may
 * grow to. A picker fills that height; a preview card never does, so painting
 * it at the reserved top left it floating a couple of hundred pixels above its
 * own chip — the same detachment TokenMenu solves with a second measuring pass.
 *
 * A card needs no second pass, because it can be anchored by the edge that
 * matters instead: opening upward, the bottom stays a fixed gap above the chip
 * and the box grows away from it. `top + maxHeight` is exactly that edge, and
 * `position: fixed` reads `bottom` against the layout viewport, which is the
 * space the anchor's own rect is already in.
 */
function offsetStyle(p: Placed): { top: number } | { bottom: number } {
  // Whole pixels: a card on a half pixel renders its hairline border blurred.
  return p.side === 'below'
    ? { top: Math.round(p.top) }
    : { bottom: Math.round(window.innerHeight - (p.top + p.maxHeight)) };
}

export function ChipPreview({
  anchor,
  kind,
  src,
  label,
  warning,
  note,
  onOpen,
  onHoverIn,
  onHoverOut,
  onClose,
}: {
  anchor: HTMLElement;
  kind: PreviewKind;
  /** Always `imgUrl(hash)` off the token or the attachment. Never a lookup by position. */
  src: string;
  /** The name of the thing, when it has one. A hand-attached reference has none. */
  label?: string | null;
  /** The compiler's own warning about this attachment, said here rather than in a tooltip. */
  warning?: string | null;
  /** How this identity reaches the engine, by photo or by words. A fact, not a warning. */
  note?: string | null;
  /** Clicking the card is the same ask as clicking the chip: open it properly. */
  onOpen: () => void;
  /** The pointer reached the card, so whatever close the chip scheduled is off. */
  onHoverIn: () => void;
  onHoverOut: () => void;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<Placed | null>(null);
  const [broken, setBroken] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setBroken(false), [src]);

  useLayoutEffect(() => {
    const measure = () => {
      const vv = window.visualViewport;
      // The visual viewport, so a software keyboard cannot put the card under
      // itself. The rect and `position: fixed` are both layout coordinates.
      const p = placePanel(
        anchor.getBoundingClientRect(),
        { width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight },
        { width: PREVIEW_W },
      );
      // The brief is its own 30vh scroller: a chip can leave the screen while
      // its card is open, and a card pointing at nothing should go.
      if (!p) {
        onClose();
        return;
      }
      setPos(p);
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Not preventDefault and not stopPropagation: a peek that vanishes is
      // not what Escape was pressed for, so the chip, the overlay and anything
      // else still get the key they were listening for.
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  if (!pos) return null;
  const noun = PREVIEW_NOUN[kind];
  return createPortal(
    <div
      ref={rootRef}
      className="sc-chip-preview"
      data-kind={kind}
      data-side={pos.side}
      // Decorative, and honestly so. A role=tooltip that no trigger points at
      // with aria-describedby is never announced anyway, and everything this
      // card says is already in the chip's own label — the picture is the part
      // a screen reader cannot use. The accessible route to it is the one the
      // keyboard already has: focus the chip, press Enter, read the dialog.
      aria-hidden="true"
      style={{ left: Math.round(pos.left), ...offsetStyle(pos), maxWidth: pos.width, maxHeight: pos.maxHeight }}
      onPointerEnter={onHoverIn}
      onPointerLeave={onHoverOut}
    >
      {/* Pointer-only by design, the way the chip's own x is. `tabIndex={-1}`
          is what keeps a focusable control from sitting inside a hidden
          subtree: a keyboard never reaches this, and never needs to. */}
      <button type="button" className="sc-chip-preview-hit" tabIndex={-1} onClick={onOpen}>
        {broken ? (
          // A 404 reads the same as never having had one: the blank plate, not
          // the browser's broken-image glyph. The chip stays removable anyway.
          <span className="sc-chip-preview-plate sc-chip-preview-blank">
            <ImageSquare size={20} />
            Image unavailable
          </span>
        ) : (
          <img className="sc-chip-preview-plate" src={src} alt="" decoding="async" onError={() => setBroken(true)} />
        )}
        {/* The picker card's caption, because this is the same object said
            bigger: the picture, its name, and what kind of thing it is. */}
        {label && <b dir="auto">{label}</b>}
        <span>{noun}</span>
      </button>
      {note && <p className="sc-chip-preview-note">{note}</p>}
      {warning && <p className="sc-swap-warn">{warning}</p>}
    </div>,
    document.body,
  );
}
