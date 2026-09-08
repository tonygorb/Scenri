import { UserCircle } from '@phosphor-icons/react';
import { imgUrl, thumbUrl } from '../../api.js';
import { elapsedLabel } from '../../tasks.js';
import type { StripItem, StudioView } from './presenterStudioRules.js';

/**
 * The picture, and the views under it.
 *
 * The well is the one place identity is judged, so it shows the frame at
 * its own resolution once it arrives (the 640 derivative paints first). The
 * strip is the Figma strip: five 90 x 112 tiles at an 8px pitch with the
 * label centred under each, the one on the stage outlined in ink and the
 * others at half strength. It is the progress and the navigation; no step
 * numbers.
 */
export function StudioStage({
  hash,
  alt,
  drawing,
  since,
  now,
  items,
  onPick,
}: {
  /** The frame on the stage; none draws the empty well. */
  hash?: string;
  alt: string;
  /** The stage's own view is being drawn: dim the last picture, run the clock. */
  drawing: boolean;
  /** When the current step started, for the clock. */
  since?: string;
  now: number;
  items: StripItem[];
  onPick?: (view: StudioView) => void;
}) {
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
            <span className={`sc-pstudio-well-blank${drawing ? ' sc-shimmer' : ''}`} aria-hidden>
              {!drawing && <UserCircle size={96} weight="thin" />}
            </span>
          )}
          {drawing && (
            <span className="sc-pstudio-clock" aria-hidden>
              <span className="sc-shimmer" />
              {since && <time>{elapsedLabel(since, now)}</time>}
            </span>
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
              (it.drawing ? ', drawing' : '');
            return (
              <li key={it.view}>
                <button
                  type="button"
                  className="sc-pstudio-slot"
                  data-state={it.state}
                  aria-current={it.state === 'current' ? 'step' : undefined}
                  aria-label={name}
                  disabled={!onPick}
                  onClick={() => onPick?.(it.view)}
                >
                  <span className="sc-pstudio-slot-inner">
                    {it.hash ? <img src={thumbUrl(it.hash, 'micro')} alt="" /> : null}
                    {it.drawing ? <span className="sc-shimmer" aria-hidden /> : null}
                    {it.approved && !it.drawing ? (
                      <span className="sc-pstudio-slot-mark" aria-hidden>
                        &#10003;
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
