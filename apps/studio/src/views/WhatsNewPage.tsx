import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { ArrowSquareOut, CaretDown } from '@phosphor-icons/react';
import type { ReleaseEntry } from '../api.js';
import { useWhatsNew } from '../app/WhatsNew.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import {
  FAILED,
  NOTHING_YET,
  ReleaseAreas,
  ReleaseMeta,
  ReleaseNotesLink,
  WhatsNewLightbox,
  WhatsNewPicture,
  pictureOf,
} from './WhatsNewParts.js';

/**
 * What changed in Scenri, from the newest release back to the first public one.
 *
 * Help, not a place: it lights nothing in the bar, and the places, the mark and
 * Back are the ways out, so it carries no X. It names itself because nothing in
 * the bar does. Newest first, one timeline: each release its date, version and
 * release notes in a column, then the update, every one in the same sizes.
 * The releases before the recent ones are one line each that opens
 * to its words. The whole history is in the build; it shows ten releases at a
 * time and the next ten as the end comes into view, through a real button that
 * a keyboard reaches too. Full release notes on GitHub is the archive for every
 * fix a record left out. Each release has an address (`#v0.19.0`). Opening the
 * page reads everything on it.
 */
/** How many releases the page adds at a time. */
const PAGE = 10;

export function WhatsNewPage() {
  const { status, recent, history, featured, running, releasesUrl, notesFor, markSeen } = useWhatsNew();
  const { hash } = useLocation();
  // Ten at a time, never fewer than the recent ones; a link to an older release shows down to it.
  const asked = hash.startsWith('#v') ? history.findIndex((r) => `#v${r.version}` === hash) + 1 : 0;
  const [count, setCount] = useState(PAGE);
  const shown = Math.min(history.length, Math.max(count, recent.length, asked));
  const more = shown < history.length;
  // The next ten, from the button or from scrolling. The button stays one
  // element while there is more, so a keyboard press keeps its place; the
  // press that loads the last of them takes the button away, so the keyboard
  // moves to the first release it brought instead of falling to nothing.
  const landOn = useRef<string | null>(null);
  const loadMore = (fromKeyboardFocus: boolean) => {
    landOn.current = fromKeyboardFocus ? (history[shown]?.version ?? null) : null;
    setCount(shown + PAGE);
  };
  useEffect(() => {
    const version = landOn.current;
    landOn.current = null;
    if (!version || more) return;
    document.getElementById(`v${version}`)?.querySelector<HTMLElement>('summary')?.focus();
  }, [shown, more]);

  useEffect(() => {
    if (status === 'ready') markSeen();
  }, [status, markSeen]);

  // Arriving from a menu or a dialog, their own focus restore runs after the
  // navigation; the heading takes the keyboard once they are done. A link to
  // one release lands on it instead.
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
  useEffect(() => {
    if (status !== 'ready' || !hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' });
  }, [status, hash]);

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
        ) : status === 'ready' && history.length === 0 ? (
          <p className="sc-wn-txt">{NOTHING_YET}</p>
        ) : (
          <>
            <ol className="sc-wn-list">
              {history.slice(0, Math.min(shown, recent.length)).map((r) => (
                <UpdateRow
                  current={r.version === running}
                  key={r.version}
                  entry={r}
                  lead={r.version === featured?.version}
                  notes={notesFor(r.version)}
                />
              ))}
            </ol>
            {shown > recent.length && (
              <section className="sc-wn-part" aria-labelledby="sc-wn-earlier">
                <h2 id="sc-wn-earlier" className="sc-vh">
                  Earlier releases
                </h2>
                <ol className="sc-wn-olds">
                  {history.slice(recent.length, shown).map((r) => (
                    <OlderRow
                      current={r.version === running}
                      key={r.version}
                      entry={r}
                      open={hash === `#v${r.version}`}
                      notes={notesFor(r.version)}
                    />
                  ))}
                </ol>
              </section>
            )}
            {more && <OlderUpdates count={shown} onMore={loadMore} />}
          </>
        )}

        {status === 'ready' && releasesUrl && (
          <footer className="sc-wn-page-foot">
            <p>Every version, and every fix the notes here leave out, is in the full release notes.</p>
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
 * One release in the timeline: its title, a line per area, and its one
 * picture when it has one, which opens larger. Headline or small, every
 * update is set the same way. `lead` (the newest headline) only loads its
 * picture first.
 */
function UpdateRow({
  entry,
  lead,
  current,
  notes,
}: {
  entry: ReleaseEntry;
  lead: boolean;
  current: boolean;
  notes: string | null;
}) {
  const headline = !!entry.announce;
  const picture = pictureOf(entry);
  const [large, setLarge] = useState(false);
  return (
    <li
      className="sc-wn-row"
      id={`v${entry.version}`}
      data-kind={headline ? 'headline' : 'small'}
      data-lead={lead || undefined}
    >
      <div className="sc-wn-side">
        <ReleaseMeta entry={entry} current={current} />
        {notes && <ReleaseNotesLink href={notes} version={entry.version} />}
      </div>
      <div className="sc-wn-what">
        {entry.title && <h2 className="sc-wn-row-hed">{entry.title}</h2>}
        {picture && <WhatsNewPicture picture={picture} eager={lead} onOpen={() => setLarge(true)} />}
        <ReleaseAreas sections={entry.sections} />
      </div>
      {large && picture && <WhatsNewLightbox src={picture.src} alt={picture.alt} onClose={() => setLarge(false)} />}
    </li>
  );
}

/**
 * A release older than the recent ones, folded: the same date column and the
 * same title as every update above it, opening to the words it shipped with.
 * Those words were written before today's rules, so they wait to be asked for
 * rather than filling the page. A native disclosure: the keyboard, a screen
 * reader and a link to its address (`#v0.9.0`) all open it.
 */
function OlderRow({
  entry,
  open,
  current,
  notes,
}: {
  entry: ReleaseEntry;
  open: boolean;
  current: boolean;
  notes: string | null;
}) {
  return (
    <li className="sc-wn-old" id={`v${entry.version}`}>
      <details open={open || undefined}>
        <summary>
          <ReleaseMeta entry={entry} current={current} />
          <span className="sc-wn-old-hed">{entry.title ?? entry.sections.map((s) => s.heading).join(', ')}</span>
          <CaretDown size={14} className="sc-wn-old-caret" aria-hidden="true" />
        </summary>
        <div className="sc-wn-old-body">
          <ReleaseAreas sections={entry.sections} />
          {notes && <ReleaseNotesLink href={notes} version={entry.version} />}
        </div>
      </details>
    </li>
  );
}

/**
 * The next ten releases: loads by itself as it comes into view, and is a real
 * button, so a keyboard or a screen reader reaches the older history the same
 * way. No spinner: the history is already in the build.
 */
function OlderUpdates({ count, onMore }: { count: number; onMore: (fromKeyboardFocus: boolean) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const more = useRef(onMore);
  more.current = onMore;
  // Watched afresh for every count, on the same button: a button still in
  // view after a load has to ask again, and a new button would lose the
  // keyboard that pressed it.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((seen) => seen.some((e) => e.isIntersecting) && more.current(false), {
      rootMargin: '0px 0px 480px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [count]);
  return (
    <div className="sc-wn-more">
      <button
        ref={ref}
        type="button"
        className="sc-btn sc-btn-ghost"
        onClick={() => more.current(document.activeElement === ref.current)}
      >
        Show older updates
      </button>
    </div>
  );
}
