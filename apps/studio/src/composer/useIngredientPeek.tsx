import { type FocusEvent, type MouseEvent, type PointerEvent, useEffect, useState } from 'react';
import { thumbOf } from '../api.js';
import { useNavigate } from 'react-router';
import { ChipPreview, type PreviewKind } from './ChipPreview.js';
import { ImageLightbox } from './ImageLightbox.js';
import { useHoverPreview } from './useHoverPreview.js';

/** What a chip peeks: the picture, the noun, and where the card is a door to. */
export type PeekAt = {
  key: string;
  src: string;
  kind: PreviewKind;
  label: string;
  /** A catalog page: the card is a door to it. Absent, the card opens the image. */
  to?: string;
};
type Peek = PeekAt & { el: HTMLElement };

/**
 * One card for hover-peeks and for chips pinned open by a click alike, the
 * behaviour every read-only ingredient chip shares: hovering peeks, a click
 * pins the card, the card is the door (to the catalog page for the things
 * that have one, to the lightbox for the images themselves), a second click
 * on the chip, Escape, or a press anywhere else puts it away.
 *
 * `chips` is the selector of the chips this card belongs to, so a press on a
 * sibling chip swaps the card rather than merely dismissing it.
 */
export function useIngredientPeek(chips: string) {
  const navigate = useNavigate();
  const hover = useHoverPreview<Peek>();
  const { shown: hovered, closeNow: closePeek } = hover;
  const [pinned, setPinned] = useState<Peek | null>(null);
  const peek = pinned ?? hovered;
  const closeCard = () => {
    setPinned(null);
    closePeek();
  };
  useEffect(() => {
    if (!pinned) return;
    const down = (e: globalThis.PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('.sc-chip-preview') || t?.closest(chips)) return;
      setPinned(null);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [pinned, chips]);
  const [lightbox, setLightbox] = useState<{ src: string; kind: PreviewKind; label: string | null } | null>(null);

  /** The handlers a chip wears, plus the attribute saying its card is up. */
  const bind = (at: PeekAt) => ({
    'data-open': peek?.key === at.key || undefined,
    'aria-haspopup': 'dialog' as const,
    onPointerEnter: (e: PointerEvent<HTMLElement>) =>
      e.pointerType === 'mouse' && !pinned && hover.open({ ...at, el: e.currentTarget }),
    onPointerLeave: (e: PointerEvent<HTMLElement>) => e.pointerType === 'mouse' && hover.close(),
    onFocus: (e: FocusEvent<HTMLElement>) =>
      e.currentTarget.matches(':focus-visible') && !pinned && hover.open({ ...at, el: e.currentTarget }),
    onClick: (e: MouseEvent<HTMLElement>) => {
      // a second press on the pinned chip puts the card away
      if (pinned?.key === at.key) {
        closeCard();
        return;
      }
      closePeek();
      setPinned({ ...at, el: e.currentTarget });
    },
  });

  const surface = (
    <>
      {peek && (
        <ChipPreview
          key={peek.key}
          anchor={peek.el}
          kind={peek.kind}
          src={thumbOf(peek.src, 'tile')}
          label={peek.label}
          onOpen={() => {
            const target = peek;
            closeCard();
            if (target.to) navigate(target.to);
            else setLightbox({ src: thumbOf(target.src, 'full'), kind: target.kind, label: target.label });
          }}
          onHoverIn={hover.keep}
          onHoverOut={() => !pinned && hover.close()}
          onClose={closeCard}
        />
      )}
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          kind={lightbox.kind}
          label={lightbox.label}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );

  return { bind, isOpen: (key: string) => peek?.key === key, surface };
}
