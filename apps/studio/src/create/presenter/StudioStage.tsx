import { CaretDown, CaretUp, Check, UserCircle, Warning } from '@phosphor-icons/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { imgUrl, thumbUrl } from '../../api.js';
import { elapsedLabel } from '../../tasks.js';
import type { StripItem, StudioView, Take } from './presenterStudioRules.js';

/**
 * The picture, and the views under it.
 *
 * The well is the one place identity is judged, so it shows the frame at
 * its own resolution once it arrives (the 640 derivative paints first). The
 * strip is the Figma strip: 90 x 112 tiles at an 8px pitch with the label
 * centred under each, the one on the stage outlined in ink and the others
 * at half strength. It is the progress and the navigation; no step numbers.
 * A candidate over a picture that stands carries a Compare press that shows
 * the one it would replace, in the same well, at the same size.
 */
export function StudioStage({
  hash,
  alt,
  drawing,
  since,
  items,
  onPick,
  compare,
  doing,
  takes,
  onTake,
}: {
  /** The frame on the stage; none draws the empty well. */
  hash?: string;
  alt: string;
  /** The stage's own view is being drawn: dim the last picture, run the clock. */
  drawing: boolean;
  /** When the current step started, for the clock. */
  since?: string;
  items: StripItem[];
  onPick?: (view: StudioView) => void;
  compare?: { on: boolean; toggle: () => void };
  /** What is being drawn, in words, for the pill on the stage. */
  doing?: string;
  /** The pictures this view has worn, when it has worn more than one. */
  takes?: Take[];
  /** Put one of them back on the view. */
  onTake?: (hash: string) => void;
}) {
  const now = useNow(drawing);
  return (
    <div className="sc-pstudio-stage">
      <div className="sc-pstudio-wrap">
        <div className="sc-pstudio-well" data-drawing={drawing || undefined} data-empty={!hash || undefined}>
          {hash ? (
            <img
              key={hash}
              src={imgUrl(hash)}
              srcSet={`${thumbUrl(hash, 'tile')} 640w, ${imgUrl(hash)} 1024w`}
              sizes="(max-width: 767px) 92vw, 44vw"
              alt={alt}
              decoding="async"
            />
          ) : (
            <span className="sc-pstudio-well-blank" aria-hidden>
              {!drawing && <UserCircle size={96} weight="thin" />}
            </span>
          )}
          {drawing && hash && <span className="sc-pstudio-veil" aria-hidden />}
          {drawing && (
            <span className="sc-pstudio-doing" role="status">
              <span className="sc-pstudio-ring" aria-hidden />
              <span>{doing ?? 'Drawing'}</span>
              {since && <time>{elapsedLabel(since, now)}</time>}
            </span>
          )}
          {compare && !drawing && (
            <button type="button" className="sc-pstudio-compare" aria-pressed={compare.on} onClick={compare.toggle}>
              {compare.on ? 'Showing current' : 'Compare'}
            </button>
          )}
        </div>
        {takes && takes.length > 1 && <TakesRail takes={takes} onTake={onTake} />}
      </div>
      {items.length > 0 && (
        <ol className="sc-pstudio-strip" aria-label="Views">
          {items.map((it) => {
            const name =
              it.label +
              (it.approved ? ', used' : it.state === 'stale' ? ', to be drawn again' : '') +
              (it.photo ? ', your photo' : '') +
              (it.drawing ? ', drawing' : '') +
              (it.error ? ', failed' : '');
            return (
              <li key={it.view}>
                <button
                  type="button"
                  className="sc-pstudio-slot"
                  data-state={it.state}
                  data-view={it.view}
                  aria-current={it.state === 'current' ? 'step' : undefined}
                  aria-label={name}
                  disabled={!onPick}
                  onClick={() => onPick?.(it.view)}
                >
                  <span className="sc-pstudio-slot-inner">
                    {it.hash ? <img src={thumbUrl(it.hash, 'micro')} alt="" /> : null}
                    {it.drawing ? <span className="sc-pstudio-slot-work sc-pstudio-ring" aria-hidden /> : null}
                    {it.approved && !it.drawing ? (
                      <span className="sc-pstudio-slot-mark" aria-hidden>
                        <Check size={11} weight="bold" />
                      </span>
                    ) : null}
                    {it.error && !it.drawing ? (
                      <span className="sc-pstudio-slot-mark" data-tone="alert" aria-hidden>
                        <Warning size={11} weight="bold" />
                      </span>
                    ) : null}
                  </span>
                </button>
                <span className="sc-pstudio-slot-lb" data-on={it.state === 'current' || undefined} aria-hidden>
                  {it.label}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** A second hand while something draws; still otherwise. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return now;
}

/**
 * The pictures a view has worn, beside it: newest last, the one on the stage
 * lit, one press puts an older one back.
 *
 * A person who refines a face a few times has three or four; a person who
 * keeps going can have fifty. So the rail is a window, not a list: it is as
 * tall as the picture, it scrolls, the one on the stage is scrolled to
 * whenever it changes, the edges fade where there is more, and a press at
 * either end moves a page. The count says how many there are, so a long
 * history reads as a number rather than as an endless column.
 */
function TakesRail({ takes, onTake }: { takes: Take[]; onTake?: (hash: string) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState<'none' | 'up' | 'down' | 'both'>('none');
  const current = takes.find((t) => t.current);
  const read = useCallback(() => {
    const el = list.current;
    if (!el) return;
    const top = el.scrollTop > 4;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 4;
    setMore(top && bottom ? 'both' : top ? 'up' : bottom ? 'down' : 'none');
  }, []);
  // the one on the stage is always in the window, whichever it becomes
  useLayoutEffect(() => {
    const el = list.current?.querySelector('[data-on]');
    el?.scrollIntoView({ block: 'nearest' });
    read();
  }, [read]);
  // and the window's own size decides where the edges fade
  useEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [read]);
  const page = (dir: 1 | -1) => {
    const el = list.current;
    if (el) el.scrollBy({ top: dir * Math.max(120, el.clientHeight - 60), behavior: 'smooth' });
  };
  const overflows = more !== 'none';
  return (
    <nav className="sc-pstudio-takes" data-more={more} aria-label={`${takes.length} pictures of this view`}>
      {overflows && (
        <button type="button" className="sc-pstudio-takes-step" aria-label="Earlier pictures" onClick={() => page(-1)}>
          <CaretUp size={12} weight="bold" />
        </button>
      )}
      <div ref={list} className="sc-pstudio-takes-list" onScroll={read}>
        {takes.map((t) => (
          <button
            key={t.hash}
            type="button"
            className="sc-pstudio-take"
            data-on={t.current || undefined}
            aria-current={t.current || undefined}
            aria-label={`Picture ${t.n} of ${takes.length}${t.current ? ', on the stage' : ''}`}
            disabled={!onTake || t.current}
            onClick={() => onTake?.(t.hash)}
          >
            <img src={thumbUrl(t.hash, 'micro')} alt="" loading="lazy" decoding="async" />
            <span aria-hidden>{t.n}</span>
          </button>
        ))}
      </div>
      {overflows && (
        <button type="button" className="sc-pstudio-takes-step" aria-label="Later pictures" onClick={() => page(1)}>
          <CaretDown size={12} weight="bold" />
        </button>
      )}
      <span className="sc-pstudio-takes-n" aria-hidden>
        {current ? `${current.n}/${takes.length}` : takes.length}
      </span>
    </nav>
  );
}
