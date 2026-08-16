import { Dialog } from '@radix-ui/themes';
import { ArrowSquareOut, X } from '@phosphor-icons/react';
import { useDialogParam } from '../app/AppShell.js';
import { focusSelfOnOpen } from '../app/dialogs.js';
import { useWhatsNew } from '../app/WhatsNew.js';

/**
 * What changed, in the version you are running. Small on purpose.
 *
 * Not a changelog: two to four product areas, one line each, written by a
 * person. The commit-level list lives on the release page and is one link
 * away for anyone who wants it. Nothing here asks the user to do anything —
 * the only button closes it — because the asking belongs to the update float.
 *
 * Every way out is an acknowledgement. Escape, the ×, the backdrop and "Got
 * it" all mean the same thing, so there is no way to read it and still be
 * shown it again.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** yyyy-mm-dd as a local date. `new Date(iso)` reads it as UTC and slips a day west of Greenwich. */
function readableDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function WhatsNewDialog() {
  const param = useDialogParam('whatsnew');
  const { status, version, entry, changelogUrl, markSeen } = useWhatsNew();
  const open = param.value !== null;

  const close = () => {
    markSeen();
    param.close();
  };

  const heading = version ? `What's new in scenri ${version}` : "What's new";
  const described =
    entry?.title ??
    (entry
      ? readableDate(entry.date)
      : status === 'failed'
        ? 'Release notes unavailable'
        : status === 'loading'
          ? 'Loading'
          : 'Release information');

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Content maxWidth="440px" className="sc-wn" onOpenAutoFocus={focusSelfOnOpen}>
        <Dialog.Close>
          <button type="button" className="sc-set-close sc-dlg-close" aria-label="Close">
            <X size={16} />
          </button>
        </Dialog.Close>
        <Dialog.Title>{heading}</Dialog.Title>
        <Dialog.Description className="sc-wn-sub">{described}</Dialog.Description>
        {entry?.title && <p className="sc-wn-date">{readableDate(entry.date)}</p>}

        <div className="sc-wn-body">
          {entry && entry.sections.length > 0 ? (
            entry.sections.map((s) => (
              <section key={s.heading} className="sc-wn-sec">
                <h3 className="sc-wn-head">{s.heading}</h3>
                <p className="sc-wn-txt">{s.body}</p>
              </section>
            ))
          ) : (
            // Four different silences, and saying the wrong one is worse than
            // saying nothing: a maintenance release chose to have no news, a
            // version with no record means nobody wrote one, a failed read
            // means we do not know either way, and a read still in flight
            // should not accuse anyone of anything.
            <p className="sc-wn-txt">
              {status === 'loading'
                ? 'Reading the release notes.'
                : status === 'failed'
                  ? 'scenri could not read its release notes. If you are running a development server, it may predate this feature; restart it and try again.'
                  : entry
                    ? 'Maintenance only. Nothing here changes how scenri works for you. The full list of changes is on the release page.'
                    : 'This version went out without a written summary. The full list of changes is on the release page.'}
            </p>
          )}
        </div>

        <div className="sc-wn-foot">
          {changelogUrl && (
            <a className="sc-wn-link" href={changelogUrl} target="_blank" rel="noreferrer">
              Full changelog
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
