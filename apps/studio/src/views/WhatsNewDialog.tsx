import { ArrowSquareOut, X } from '@phosphor-icons/react';
import { useDialogParam } from '../app/AppShell.js';
import { useWhatsNew } from '../app/WhatsNew.js';
import { DialogSheet, SheetClose, SheetDescription, SheetTitle } from '../layout/DialogSheet.js';
import { readableDate } from '../release.js';

/**
 * What changed, in the version you are running.
 *
 * The ordinary What's new dialog: this release, then a way out. History is
 * the releases page. A written lede, when there is one, is this screen's one
 * Playfair moment. One product area is the sentence alone; two to four keep
 * their names as captions.
 *
 * Nothing here asks the user to do anything; the asking belongs to the update
 * float. Every way out is an acknowledgement — Escape, the ×, the backdrop and
 * "Got it" all mean the same thing, so there is no way to read it and still be
 * shown it again.
 */

export function WhatsNewDialog() {
  const param = useDialogParam('whatsnew');
  const { status, version, entry, changelogUrl, releasesUrl, markSeen } = useWhatsNew();
  const open = param.value !== null;

  const close = () => {
    markSeen();
    param.close();
  };

  const unreleased = status === 'ready' && !entry && !changelogUrl;
  const named = entry !== null && entry.sections.length > 1;

  const silence =
    status === 'loading'
      ? 'Reading the release notes.'
      : status === 'failed'
        ? 'scenri could not read its release notes. If you are running a development server, it may predate this feature; restart it and try again.'
        : unreleased
          ? 'You are running a development build. What changed in a version appears here once that version is published.'
          : entry
            ? 'Maintenance only. Nothing here changes how scenri works for you.'
            : 'This version went out without a written summary.';

  const subtitle = entry ? (
    <>
      <span className="sc-vh">Version </span>
      <span className="sc-wn-ver">{entry.version}</span>
      <span aria-hidden="true"> · </span>
      {readableDate(entry.date)}
    </>
  ) : status === 'failed' ? (
    'Release notes unavailable'
  ) : status === 'loading' ? (
    'Loading'
  ) : unreleased ? (
    'Development build'
  ) : (
    <>
      <span className="sc-vh">Version </span>
      <span className="sc-wn-ver">{version}</span>
    </>
  );

  return (
    <DialogSheet open={open} className="sc-wn" maxWidth="420px" described onDismiss={close}>
      <div className="sc-newdlg-head">
        <SheetTitle className="sc-newdlg-title">What's new</SheetTitle>
        <SheetClose>
          <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
            <X size={16} />
          </button>
        </SheetClose>
      </div>

      <SheetDescription className="sc-wn-sub">{subtitle}</SheetDescription>

      <div className="sc-newdlg-body">
        {entry?.title && <p className="sc-wn-lede sc-accent">{entry.title}</p>}
        {entry && entry.sections.length > 0 ? (
          entry.sections.map((s) => (
            <section key={s.heading} className="sc-wn-sec">
              {named && <h3 className="sc-wn-head">{s.heading}</h3>}
              <p className="sc-wn-txt">{s.body}</p>
            </section>
          ))
        ) : (
          <p className="sc-wn-txt">{silence}</p>
        )}
      </div>

      <div className="sc-newdlg-foot sc-wn-foot">
        {releasesUrl && (
          <a className="sc-wn-link" href={releasesUrl} target="_blank" rel="noreferrer">
            All releases
            <ArrowSquareOut size={13} />
          </a>
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
