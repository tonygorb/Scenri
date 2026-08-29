import { useState } from 'react';
import { ImageSquare } from '@phosphor-icons/react';
import { DialogSheet } from '../layout/DialogSheet.js';
import type { PreviewKind } from './ChipPreview.js';
import { PREVIEW_NOUN } from './ChipPreview.js';

/**
 * One attached image, big enough to actually read.
 *
 * Deliberately the app's own dialog shell rather than a viewer of its own: a
 * black full-bleed lightbox is a convention from photo sites, not from
 * anything else in Scenri, and `DialogSheet` already carries the scrim, the
 * portal, Escape, the drag-to-dismiss on a phone and the sheet-or-card
 * responsive rule. So this is a dialog that happens to be almost entirely
 * picture, which is what "look at it properly" should feel like here.
 *
 * No zoom, no pan, no next/previous. The reference is one image and the
 * question is only ever "which one is it".
 */
export function ImageLightbox({
  src,
  kind,
  label,
  onRestoreFocus,
  onClose,
}: {
  src: string;
  kind: PreviewKind;
  label?: string | null;
  /**
   * Where focus belongs once this closes.
   *
   * Radix hands it back to whatever opened the dialog, which here is a chip
   * inside a contenteditable — and on a focused chip the next Backspace is a
   * removal. So the default is refused and the caller puts the caret back,
   * the same way `ChipMoveSheet` refuses it to keep a software keyboard down.
   */
  onRestoreFocus?: () => void;
  onClose: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const noun = PREVIEW_NOUN[kind];

  return (
    <DialogSheet
      className="sc-lightbox"
      maxWidth="min(880px, 92vw)"
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        onRestoreFocus?.();
      }}
      onDismiss={onClose}
    >
      <div className="sc-lightbox-frame" data-kind={kind}>
        {broken ? (
          <span className="sc-lightbox-blank">
            <ImageSquare size={28} />
            Image unavailable
          </span>
        ) : (
          <img src={src} alt={label ? `${label}, ${noun.toLowerCase()}` : noun} onError={() => setBroken(true)} />
        )}
      </div>
      <p className="sc-lightbox-cap">
        {label && <b dir="auto">{label}</b>}
        <span>{noun}</span>
      </p>
    </DialogSheet>
  );
}
