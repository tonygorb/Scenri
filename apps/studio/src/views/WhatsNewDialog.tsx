import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { ArrowRight, X } from '@phosphor-icons/react';
import { useDialogParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useWhatsNew } from '../app/WhatsNew.js';
import { moreLabel } from '../app/whatsNewRules.js';
import { DialogSheet, SheetClose, SheetDescription, SheetTitle } from '../layout/DialogSheet.js';
import { whatsNewPath } from '../routes.js';
import { pictureUrl } from '../whatsNewPictures.js';
import { FAILED, NOTHING_YET, ON_THE_PAGE, ReleaseMeta, WhatsNewPicture, heroOf } from './WhatsNewParts.js';

/**
 * One update, introduced once.
 *
 * It opens by itself only for a headline update this computer has not read,
 * and it always shows the newest one: the picture of what changed, when, the
 * headline, and its areas as short lines. Everything else (the small updates,
 * the earlier headlines) is the What's New page, one link away. `?whatsnew`
 * opens the same update by hand.
 *
 * Nothing here asks the user to do anything. Every way out is an
 * acknowledgement (Escape, the X, the backdrop, Got it, Back, and the link to
 * the page), so there is no way to read it and still be shown it again.
 */
export function WhatsNewDialog() {
  const param = useDialogParam('whatsnew');
  const { brand } = useBrand();
  const { status, featured, unseen, lead, recent, markSeen } = useWhatsNew();
  // The read is local and quick; opening only once it has answered keeps the
  // dialog from arriving as a sentence and then jumping to a picture.
  const open = param.value !== null && status !== 'loading';

  const close = () => {
    markSeen();
    param.close();
  };

  // Browser Back, and the link to the page, close it without any of the
  // dialog's own ways out, and each is still a close: read once, never again.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) markSeen();
    wasOpen.current = open;
  }, [open, markSeen]);

  // How many other updates are waiting, counted as it opens: acknowledging
  // clears them while the dialog is still animating away.
  const snap = useRef({ open: false, more: 0 });
  if (open && !snap.current.open) {
    snap.current = { open: true, more: unseen.filter((v) => v !== featured?.version).length };
  } else if (!open) snap.current.open = false;

  // The settle before it opens by itself is time enough to decode its picture.
  const hero = heroOf(featured);
  const heroUrl = hero ? pictureUrl(hero.file) : null;
  useEffect(() => {
    if (lead && heroUrl) new Image().src = heroUrl;
  }, [lead, heroUrl]);

  // Leaving by the link hands the keyboard to the page, not back to whatever
  // the dialog opened over.
  const toPage = useRef(false);
  const named = featured !== null && featured.sections.length > 1;

  return (
    <DialogSheet
      open={open}
      className="sc-wn"
      maxWidth="480px"
      described
      onDismiss={close}
      onCloseAutoFocus={(e) => {
        if (toPage.current) {
          e.preventDefault();
          toPage.current = false;
        }
      }}
    >
      <div className="sc-newdlg-head">
        <SheetTitle className="sc-newdlg-title">What's new</SheetTitle>
        <SheetClose>
          <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
            <X size={16} />
          </button>
        </SheetClose>
      </div>

      <div className="sc-newdlg-body">
        {featured ? (
          <>
            {hero && <WhatsNewPicture key={hero.file} image={hero} eager />}
            <ReleaseMeta entry={featured} />
            <SheetDescription asChild>
              <h3 className="sc-wn-hed">{featured.title}</h3>
            </SheetDescription>
            <ul className="sc-wn-hls">
              {featured.sections.map((s) => (
                <li key={s.heading} className="sc-wn-hl">
                  {named && (
                    <>
                      <b className="sc-wn-hl-h">{s.heading}</b>
                      <span className="sc-vh">:</span>{' '}
                    </>
                  )}
                  {s.body}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <SheetDescription className="sc-wn-txt">
            {status === 'failed' ? FAILED : recent.length > 0 ? ON_THE_PAGE : NOTHING_YET}
          </SheetDescription>
        )}
      </div>

      <div className="sc-newdlg-foot sc-wn-foot">
        {recent.length > 0 && (
          <Link
            className="sc-wn-link"
            to={whatsNewPath(brand)}
            replace
            onClick={(e) => {
              // a modified click opens the page elsewhere and leaves this dialog open
              if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) toPage.current = true;
            }}
          >
            {moreLabel(snap.current.more)}
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        )}
        <SheetClose>
          <button type="button" className="sc-btn sc-btn-primary">
            Got it
          </button>
        </SheetClose>
      </div>
    </DialogSheet>
  );
}
