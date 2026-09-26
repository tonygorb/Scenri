import { type ReactNode, useRef, useState } from 'react';
import { ImageSquare, X } from '@phosphor-icons/react';
import { DialogSheet, SheetClose } from '../layout/DialogSheet.js';
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
  noun: nounHere,
  actions,
  onRestoreFocus,
  onClose,
}: {
  src: string;
  kind: PreviewKind;
  label?: string | null;
  /** What the caption calls the thing, when the kind's own noun is not the whole truth here. */
  noun?: string;
  /** What can be done with this picture, under its caption: a scene's example offers Try again and Remove. */
  actions?: ReactNode;
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
  const noun = nounHere ?? PREVIEW_NOUN[kind];
  /**
   * Where the keyboard was when this opened.
   *
   * Radix hands focus back to a dialog's trigger, and a lightbox opened from
   * state has none, so closing one left the keyboard on the page behind it:
   * a record page's own pictures could be opened but never left. A caller with
   * somewhere better to put it (the composer's caret) still wins.
   */
  const back = useRef<HTMLElement | null>(null);

  return (
    <DialogSheet
      className="sc-lightbox"
      maxWidth="min(880px, 92vw)"
      onOpenAutoFocus={() => {
        back.current = document.activeElement as HTMLElement | null;
      }}
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        if (onRestoreFocus) return onRestoreFocus();
        if (back.current?.isConnected) back.current.focus();
      }}
      onDismiss={onClose}
    >
      {/* Past 768 the sheet has no grip, and Escape or a press on the scrim is
          no door a tablet shows: the way out is the dialogs' own close. */}
      <div className="sc-newdlg-head sc-lightbox-head">
        <SheetClose>
          <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
            <X size={16} />
          </button>
        </SheetClose>
      </div>
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
      {actions && <div className="sc-lightbox-acts">{actions}</div>}
    </DialogSheet>
  );
}
