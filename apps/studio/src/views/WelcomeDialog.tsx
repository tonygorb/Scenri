import { X } from '@phosphor-icons/react';
import { DialogSheet, SheetClose, SheetDescription, SheetTitle } from '../layout/DialogSheet.js';
import { WELCOME } from '../guidedTasks.js';

/**
 * The first thing a new install says, once, when its first page has settled
 * (DESIGN.md, "First use"): what Scenri makes, in one line, over one product
 * shot in three worlds. It offers to make the first shot together and gets
 * out of the way: every way out that is not taking it is Not now, and First
 * steps on Home keeps the offer.
 */
export function WelcomeDialog({
  open,
  pictures,
  note,
  onTake,
  onDecline,
}: {
  open: boolean;
  pictures: string[];
  /** What the first shot will ask of this install: a setup, or a few minutes. */
  note: string;
  onTake: () => void;
  onDecline: () => void;
}) {
  return (
    <DialogSheet open={open} className="sc-welcome" maxWidth="440px" described tone="guide" onDismiss={onDecline}>
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
          <button type="button" className="sc-set-close sc-newdlg-close" aria-label={WELCOME.notNow}>
            <X size={16} />
          </button>
        </SheetClose>
      </div>
      <SheetDescription className="sc-welcome-lede">{WELCOME.lede}</SheetDescription>
      <div className="sc-newdlg-foot sc-welcome-foot">
        <p className="sc-welcome-note">{note}</p>
        <button type="button" className="sc-btn sc-btn-ghost" onClick={onDecline}>
          {WELCOME.notNow}
        </button>
        <button type="button" className="sc-btn sc-btn-primary" onClick={onTake}>
          {WELCOME.take}
        </button>
      </div>
    </DialogSheet>
  );
}
