import { Dialog } from '@radix-ui/themes';
import { ArrowSquareOut, X } from '@phosphor-icons/react';
import { useDialogParam } from '../app/AppShell.js';
import { focusSelfOnOpen } from '../app/dialogs.js';
import { useWhatsNew } from '../app/WhatsNew.js';
import { readableDate, summarise } from '../release.js';

/**
 * What changed, in the version you are running, with the last few behind it.
 *
 * Not a changelog: the release you have gets two to four product areas of a
 * line each, and the three before it get one line apiece — enough to answer
 * "did I miss anything" without reading a feed. The complete archive is the
 * releases page and is one link away. Nothing here asks the user to do
 * anything; the asking belongs to the update float.
 *
 * The version is a fact, not the headline. It sits under the title in the
 * dialog's own description, which is also what a screen reader is handed when
 * focus arrives, so it is stated once and quietly.
 *
 * Every way out is an acknowledgement. Escape, the ×, the backdrop and "Got
 * it" all mean the same thing, so there is no way to read it and still be
 * shown it again.
 */

/** Enough to see what you missed, few enough that it is still a footnote. */
const EARLIER = 3;

export function WhatsNewDialog() {
  const param = useDialogParam('whatsnew');
  const { status, version, entry, releases, changelogUrl, releasesUrl, markSeen } = useWhatsNew();
  const open = param.value !== null;

  const close = () => {
    markSeen();
    param.close();
  };

  // No entry and no page of its own means this build was never released at
  // all. Deliberately `changelogUrl`, which is this exact version's page and is
  // null only for an unreleased build — `releasesUrl` is the whole index and
  // survives one, so it can never answer this question.
  const unreleased = status === 'ready' && !entry && !changelogUrl;
  // Whatever the running version is, it is the hero — never also a row below.
  const earlier = releases.filter((r) => r.version !== version).slice(0, EARLIER);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      {/* `sc-newdlg` is the app's dialog shell — fixed head, one scrolling
          body, fixed foot, and the same bottom sheet below 768px. `sc-wn` is
          only this feature's own type. */}
      <Dialog.Content maxWidth="440px" className="sc-newdlg sc-wn" onOpenAutoFocus={focusSelfOnOpen}>
        <div className="sc-newdlg-head">
          <Dialog.Title className="sc-newdlg-title">What's new</Dialog.Title>
          <Dialog.Close>
            <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
              <X size={16} />
            </button>
          </Dialog.Close>
        </div>

        <Dialog.Description className="sc-wn-sub">
          {entry ? (
            <>
              {/* Two bare numbers read as a serial number when spoken. */}
              <span className="sc-vh">Version </span>
              {entry.version}
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
              {version}
            </>
          )}
        </Dialog.Description>

        <div className="sc-newdlg-body">
          <section className="sc-wn-latest" aria-label="Latest release">
            {entry?.title && <p className="sc-wn-lede">{entry.title}</p>}
            {entry && entry.sections.length > 0 ? (
              entry.sections.map((s) => (
                <section key={s.heading} className="sc-wn-sec">
                  <h3 className="sc-wn-head">{s.heading}</h3>
                  <p className="sc-wn-txt">{s.body}</p>
                </section>
              ))
            ) : (
              // Five different silences, and saying the wrong one is worse than
              // saying nothing: a read in flight should accuse nobody, a failed
              // read means we do not know either way, an unreleased build was
              // never a release at all, a record with no sections chose to have
              // no news, and no record means nobody wrote one.
              <p className="sc-wn-txt">
                {status === 'loading'
                  ? 'Reading the release notes.'
                  : status === 'failed'
                    ? 'scenri could not read its release notes. If you are running a development server, it may predate this feature; restart it and try again.'
                    : unreleased
                      ? 'You are running a development build. What changed in a version appears here once that version is published.'
                      : entry
                        ? 'Maintenance only. Nothing here changes how scenri works for you.'
                        : 'This version went out without a written summary.'}
              </p>
            )}
          </section>

          {/* Absent entirely on a first release. An empty heading over nothing
              is worse than no heading. */}
          {earlier.length > 0 && (
            <section className="sc-wn-earlier" aria-label="Earlier releases">
              <h3 className="sc-wn-earlier-lb">Earlier releases</h3>
              {earlier.map((r) => (
                <article key={r.version} className="sc-wn-rel">
                  <p className="sc-wn-rel-meta">
                    <span className="sc-vh">Version </span>
                    {r.version}
                    <span aria-hidden="true"> · </span>
                    {readableDate(r.date)}
                  </p>
                  <p className="sc-wn-rel-sum">{summarise(r)}</p>
                </article>
              ))}
            </section>
          )}
        </div>

        <div className="sc-newdlg-foot sc-wn-foot">
          {releasesUrl && (
            <a className="sc-wn-link" href={releasesUrl} target="_blank" rel="noreferrer">
              All releases
              <ArrowSquareOut size={13} />
            </a>
          )}
          <Dialog.Close>
            <button type="button" className="sc-btn sc-btn-primary">
              Got it
            </button>
          </Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
