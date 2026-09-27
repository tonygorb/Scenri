import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, X } from '@phosphor-icons/react';
import { useDialogParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useWhatsNew } from '../app/WhatsNew.js';
import { moreLabel } from '../app/whatsNewRules.js';
import { DialogSheet, SheetClose, SheetDescription, SheetTitle } from '../layout/DialogSheet.js';
import { whatsNewPath } from '../routes.js';
import fallbackArt from '../assets/whatsnew-fallback.svg';
import stageSky from '../assets/whatsnew-stage.webp';
import { FAILED, NOTHING_YET, ReleaseMeta, WhatsNewFallback, WhatsNewPicture, pictureOf } from './WhatsNewParts.js';

/**
 * One update, introduced once.
 *
 * It opens by itself only while a headline update this computer has not read
 * is waiting, and it shows the newest update, headline or small: the one the
 * page leads with, so the dialog and the page never name two versions. An
 * excerpt: its picture on the media stage, its version and date, its title.
 * The excerpt is one link to that release on the What's New page, where its
 * areas, its release notes and every other update are. `?whatsnew` opens the
 * same update by hand. It stands behind the app's darker scrim (`tone="dim"`,
 * no blur), so a bright card under it never reads as the dialog's own edge.
 *
 * Nothing here asks the user to do anything. Every way out of a real showing
 * is an acknowledgement (Escape, the X, the backdrop, Got it, Back, and both
 * links to the page), so there is no way to read it and still be shown it again.
 */
export function WhatsNewDialog() {
  const param = useDialogParam('whatsnew');
  const { brand } = useBrand();
  const { status, featured, recent, unseen, lead, running, markSeen } = useWhatsNew();
  // The read is local and quick; opening only once it has answered keeps the
  // dialog from arriving as a sentence and then jumping to a picture.
  const open = param.value !== null && status !== 'loading';
  const shown = featured;

  // Counted as it opens: how many other updates wait. Acknowledging clears
  // them while the dialog animates away.
  const snap = useRef({ open: false, more: 0 });
  if (open && !snap.current.open) {
    snap.current = { open: true, more: unseen.filter((v) => v !== shown?.version).length };
  } else if (!open) snap.current.open = false;

  const close = () => {
    markSeen();
    param.close();
  };

  // Browser Back, and the links to the page, close it without any of the
  // dialog's own ways out, and each is still a close: read once, never again.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) markSeen();
    wasOpen.current = open;
  }, [open, markSeen]);

  // A picture that fails to load gives way to the fallback, as one that was never there.
  const [broken, setBroken] = useState<string | null>(null);
  const picture = shown && broken !== shown.version ? pictureOf(shown) : null;
  // The settle before it opens by itself is time enough to fetch its picture,
  // or the artwork that stands in for one, and the sky under either: asked for
  // first, because the page beneath may be loading a wall of pictures of its own.
  const heroUrl = picture?.src ?? fallbackArt;
  useEffect(() => {
    if (!lead) return;
    for (const src of [heroUrl, stageSky]) {
      const img = new Image();
      img.fetchPriority = 'high';
      img.src = src;
    }
  }, [lead, heroUrl]);

  // Leaving by a link hands the keyboard to the page, not back to whatever
  // the dialog opened over. A modified click opens the page elsewhere and
  // leaves this dialog open, so it hands nothing.
  const toPage = useRef(false);
  const leave = (e: MouseEvent) => {
    if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) toPage.current = true;
  };

  return (
    <DialogSheet
      open={open}
      className="sc-wn"
      tone="dim"
      maxWidth="520px"
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
        {shown ? (
          // One link, stretched over the excerpt: the picture, the date and the
          // headline are one target and one stop for the keyboard.
          <article className="sc-wn-ex">
            {picture ? (
              <WhatsNewPicture key={shown.version} picture={picture} eager onBroken={() => setBroken(shown.version)} />
            ) : (
              <WhatsNewFallback version={shown.version} current={shown.version === running} />
            )}
            <ReleaseMeta entry={shown} current={shown.version === running} hideVersion={!picture} />
            <SheetDescription asChild>
              <h3 className="sc-wn-hed">
                <Link className="sc-wn-ex-link" to={`${whatsNewPath(brand)}#v${shown.version}`} replace onClick={leave}>
                  {shown.title}
                </Link>
              </h3>
            </SheetDescription>
          </article>
        ) : (
          <SheetDescription className="sc-wn-txt">{status === 'failed' ? FAILED : NOTHING_YET}</SheetDescription>
        )}
      </div>

      <div className="sc-newdlg-foot sc-wn-foot">
        {recent.length > 0 && (
          <Link className="sc-wn-link" to={whatsNewPath(brand)} replace onClick={leave}>
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
