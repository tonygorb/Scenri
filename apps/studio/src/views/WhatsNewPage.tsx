import { useEffect, useRef } from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';
import type { ReleaseEntry } from '../api.js';
import { useWhatsNew } from '../app/WhatsNew.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { FAILED, NOTHING_YET, ReleaseMeta, WhatsNewPicture } from './WhatsNewParts.js';

/**
 * What changed in Scenri, the recent part of it, newest first.
 *
 * Help, not a place: it lights nothing in the bar, and the places, the mark and
 * Back are the ways out, so it carries no X. It names itself because nothing in
 * the bar does. The newest headline update is the large one; earlier headlines
 * are quieter, and small updates are a line per area between them. It reaches
 * back to the fifth headline update, and Full release notes on GitHub is the
 * archive for everything older and every fix a record left out.
 *
 * Opening it reads everything on it.
 */
export function WhatsNewPage() {
  const { status, recent, featured, releasesUrl, markSeen } = useWhatsNew();

  useEffect(() => {
    if (status === 'ready') markSeen();
  }, [status, markSeen]);

  // Arriving from a menu or a dialog, their own focus restore runs after the
  // navigation; the heading takes the keyboard once they are done.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let t = 0;
    const f = requestAnimationFrame(() => {
      t = window.setTimeout(() => heading.current?.focus({ preventScroll: true }), 0);
    });
    return () => {
      cancelAnimationFrame(f);
      window.clearTimeout(t);
    };
  }, []);

  return (
    <ScrollPane>
      <main className="sc-wn-page" id="main" aria-labelledby="sc-wn-title">
        <header className="sc-wn-page-head">
          <h1 id="sc-wn-title" ref={heading} tabIndex={-1}>
            What's new
          </h1>
          <p>What changed in Scenri, newest first.</p>
        </header>

        {status === 'failed' ? (
          <p className="sc-wn-txt">{FAILED}</p>
        ) : status === 'ready' && recent.length === 0 ? (
          <p className="sc-wn-txt">{NOTHING_YET}</p>
        ) : (
          <ol className="sc-wn-list">
            {recent.map((r) => (
              <UpdateRow key={r.version} entry={r} lead={r === featured} />
            ))}
          </ol>
        )}

        {status === 'ready' && releasesUrl && (
          <footer className="sc-wn-page-foot">
            <a className="sc-wn-link" href={releasesUrl} target="_blank" rel="noopener noreferrer">
              Full release notes
              <span className="sc-vh"> on GitHub, opens in a new tab</span>
              <ArrowSquareOut size={13} aria-hidden="true" />
            </a>
          </footer>
        )}
      </main>
    </ScrollPane>
  );
}

/**
 * One release. A headline update is its headline, its areas and their
 * pictures; a small one is a line per area, its name in ink, and no picture.
 */
function UpdateRow({ entry, lead }: { entry: ReleaseEntry; lead: boolean }) {
  const headline = !!entry.title;
  const named = entry.sections.length > 1;
  return (
    <li className="sc-wn-row" data-kind={headline ? 'headline' : 'small'} data-lead={lead || undefined}>
      <ReleaseMeta entry={entry} />
      <div className="sc-wn-what">
        {headline && <h2 className="sc-wn-row-hed">{entry.title}</h2>}
        {entry.sections.map((s) => (
          <div key={s.heading} className="sc-wn-area">
            <p className="sc-wn-line">
              {(named || !headline) && (
                <>
                  <b>{s.heading}</b>
                  <span className="sc-vh">:</span>{' '}
                </>
              )}
              {s.body}
            </p>
            {headline && s.image && <WhatsNewPicture key={s.image.file} image={s.image} eager={lead} />}
          </div>
        ))}
      </div>
    </li>
  );
}
