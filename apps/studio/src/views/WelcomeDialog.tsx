import { X } from '@phosphor-icons/react';
import { DialogSheet, SheetClose, SheetDescription, SheetTitle } from '../layout/DialogSheet.js';
import { WELCOME } from '../tours.js';

/**
 * The first thing a new install says, once, when its first page has settled
 * (DESIGN.md, "First use"): what Scenri makes, in one line, over one product
 * shot in three worlds. It offers the tours and gets out of the way: every
 * way out that is not Take the tour means no tours begin on their own, and the
 * help button brings any of them back.
 *
 * The help menu's Start the tours over opens it `again`: the same offer, where
 * taking it starts every tour over and declining it changes nothing.
 */
export function WelcomeDialog({
  open,
  again = false,
  pictures,
  onTake,
  onSkip,
}: {
  open: boolean;
  again?: boolean;
  pictures: string[];
  onTake: () => void;
  onSkip: () => void;
}) {
  return (
    <DialogSheet open={open} className="sc-welcome" maxWidth="440px" described onDismiss={onSkip}>
      {pictures.length > 0 && (
        <div className="sc-welcome-pics" aria-hidden="true">
          {pictures.map((src, i) => (
            <img key={src} src={src} alt="" style={{ animationDelay: `${120 + i * 60}ms` }} />
          ))}
        </div>
      )}
      <div className="sc-newdlg-head">
        <SheetTitle className="sc-newdlg-title">
          Welcome to <span className="sc-accent">Scenri</span>
        </SheetTitle>
        <SheetClose>
          <button
            type="button"
            className="sc-set-close sc-newdlg-close"
            aria-label={again ? WELCOME.notNow : WELCOME.skip}
          >
            <X size={16} />
          </button>
        </SheetClose>
      </div>
      <SheetDescription className="sc-welcome-lede">{WELCOME.lede}</SheetDescription>
      <div className="sc-newdlg-foot sc-welcome-foot">
        <p className="sc-welcome-note">{WELCOME.note}</p>
        <button type="button" className="sc-btn sc-btn-ghost" onClick={onSkip}>
          {again ? WELCOME.notNow : WELCOME.skip}
        </button>
        <button type="button" className="sc-btn sc-btn-primary" onClick={onTake}>
          {WELCOME.take}
        </button>
      </div>
    </DialogSheet>
  );
}
