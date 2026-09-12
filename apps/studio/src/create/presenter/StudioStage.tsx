import { CaretLeft, CaretRight, Check, Warning } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { imgUrl, thumbUrl } from '../../api.js';
import { elapsedLabel } from '../../tasks.js';
import type { StripItem, StudioView, Take } from './presenterStudioRules.js';
import { StageEmpty } from './StageEmpty.js';

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
  empty,
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
  /** What the stage says while it is waiting for its first picture. */
  empty?: { lead: string; hint?: string };
}) {
  const now = useNow(drawing);
  // The well keeps the picture it is showing until the next one is decoded, and
  // then swaps the source in the same element: no blank frame, and no fade
  // replayed from the dark ground on every step, which read as flashing.
  // Which of this view's pictures is being looked at. Stepping through them
  // only looks; the picture on the view changes when it is put back.
  const [peek, setPeek] = useState<string | null>(null);
  const list = takes ?? [];
  const at = Math.max(
    0,
    list.findIndex((t) => (peek ? t.hash === peek : t.current)),
  );
  const looking = list[at];
  // a new picture, or another view, and the well is back on what the view wears
  useEffect(() => setPeek(null), [hash]);
  const shown = usePainted(peek && list.some((t) => t.hash === peek) ? peek : hash);
  const step = (d: 1 | -1) => {
    const next = list[at + d];
    if (next) setPeek(next.hash);
  };
  return (
    <div className="sc-pstudio-stage">
      <div className="sc-pstudio-wrap">
        <div className="sc-pstudio-well" data-drawing={drawing || undefined} data-empty={!hash || undefined}>
          {hash && shown ? (
            <img
              src={imgUrl(shown)}
              srcSet={`${thumbUrl(shown, 'tile')} 640w, ${imgUrl(shown)} 1024w`}
              sizes="(max-width: 767px) 92vw, 44vw"
              alt={alt}
              decoding="async"
            />
          ) : (
            <span className="sc-pstudio-well-blank">
              {!drawing && <StageEmpty lead={empty?.lead} hint={empty?.hint} />}
            </span>
          )}
          {/* Waiting reads as one thing everywhere in Scenri: the same gold
              sweep the feed uses while a shot renders. Over a picture being
              drawn again a light passes across it instead, because there is
              something to look at and the state is "worked on", not "empty". */}
          {drawing && !hash && <span className="sc-shimmer" aria-hidden />}
          {drawing && hash && <span className="sc-pstudio-veil" aria-hidden />}
          {drawing && (
            <span className="sc-pstudio-doing" role="status">
              <span className="sc-pstudio-ring" aria-hidden />
              <span>{doing ?? 'Drawing'}</span>
              {since && <time>{elapsedLabel(since, now)}</time>}
            </span>
          )}
          {/* Compare is already showing another picture in this well; two ways to
              swap it at once would say different things about what you see */}
          {list.length > 1 && !drawing && !compare?.on && (
            <div className="sc-pstudio-vers">
              <button
                type="button"
                className="sc-pstudio-vers-step"
                aria-label="The version before"
                aria-disabled={at === 0 || undefined}
                onClick={() => at > 0 && step(-1)}
              >
                <CaretLeft size={13} weight="bold" />
              </button>
              <span className="sc-pstudio-vers-n">
                Version {looking?.n ?? 1} of {list.length}
              </span>
              <button
                type="button"
                className="sc-pstudio-vers-step"
                aria-label="The version after"
                aria-disabled={at === list.length - 1 || undefined}
                onClick={() => at < list.length - 1 && step(1)}
              >
                <CaretRight size={13} weight="bold" />
              </button>
              {looking && !looking.current && onTake && (
                <button type="button" className="sc-pstudio-vers-put" onClick={() => onTake(looking.hash)}>
                  Put back
                </button>
              )}
              {looking?.current && <span className="sc-pstudio-vers-on">Active</span>}
            </div>
          )}
          {compare && !drawing && (
            <button type="button" className="sc-pstudio-compare" aria-pressed={compare.on} onClick={compare.toggle}>
              {compare.on ? 'Showing current' : 'Compare'}
            </button>
          )}
        </div>
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
                    {it.drawing && !it.hash ? <span className="sc-shimmer" aria-hidden /> : null}
                    {it.drawing && it.hash ? (
                      <span className="sc-pstudio-slot-work sc-pstudio-ring" aria-hidden />
                    ) : null}
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
 * The picture the well is showing: the one asked for, but only once it can be
 * painted. A switch between versions used to unmount the old frame and mount
 * the new one empty, which read as a flash on every press; now the old frame
 * stands until the new one is decoded, and the swap is a single frame.
 */
function usePainted(hash?: string): string | undefined {
  const [shown, setShown] = useState(hash);
  useEffect(() => {
    if (!hash || hash === shown) {
      if (!hash) setShown(undefined);
      return;
    }
    let live = true;
    const done = () => {
      if (live) setShown(hash);
    };
    const img = new Image();
    img.srcset = `${thumbUrl(hash, 'tile')} 640w, ${imgUrl(hash)} 1024w`;
    img.sizes = '(max-width: 767px) 92vw, 44vw';
    img.src = imgUrl(hash);
    if (img.decode) img.decode().then(done, done);
    else {
      img.onload = done;
      img.onerror = done;
    }
    // a picture that never paints must not hold the well for ever
    const t = window.setTimeout(done, 3000);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [hash, shown]);
  return shown;
}
