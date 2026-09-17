import { X } from '@phosphor-icons/react';
import { DialogSheet, SheetClose, SheetDescription, SheetTitle } from '../layout/DialogSheet.js';

/**
 * The first thing a new install says, once, when its first page has settled
 * (DESIGN.md, "First use"). It offers the tours and gets out of the way: every
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
          <button type="button" className="sc-set-close sc-newdlg-close" aria-label={again ? 'Not now' : 'Skip tours'}>
            <X size={16} />
          </button>
        </SheetClose>
      </div>
      <SheetDescription className="sc-welcome-lede">
        Product shots on brand, made with your own products, presenters and scenes.
      </SheetDescription>
      <div className="sc-newdlg-body">
        <p className="sc-welcome-txt">A short tour shows each page the first time you open it.</p>
      </div>
      <div className="sc-newdlg-foot sc-welcome-foot">
        <p className="sc-welcome-note">Replay any tour from the ? button.</p>
        <button type="button" className="sc-btn sc-btn-ghost" onClick={onSkip}>
          {again ? 'Not now' : 'Skip tours'}
        </button>
        <button type="button" className="sc-btn sc-btn-primary" onClick={onTake}>
          Take the tour
        </button>
      </div>
    </DialogSheet>
  );
}
