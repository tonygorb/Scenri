import { ArrowClockwise } from '@phosphor-icons/react';
import { thumbUrl, type AssetBuildFrame } from '../../api.js';
import { RunningTag } from '../../layout/canvas/RunningTag.js';
import { frameLabel } from './sceneBuildRules.js';

/**
 * The set as it grows: every frame that landed, and the one being drawn. A
 * tile puts its frame on the stage; a landed view can be drawn again from
 * here on a device with a pointer, and from the stage row on any device.
 */
export function Board({
  frames,
  selected,
  cover,
  since,
  onSelect,
  onRetry,
}: {
  frames: AssetBuildFrame[];
  selected: string | null;
  cover: string | null;
  /** When the frame being drawn began, for its clock. */
  since: string | null;
  onSelect: (hash: string) => void;
  /** Draw this view again. Absent while nothing may be redrawn. */
  onRetry?: (hash: string) => void;
}) {
  if (!frames.length) return null;
  return (
    <div className="sc-sb-board" role="toolbar" aria-label="Frames" aria-orientation="horizontal">
      {frames.map((f) => {
        const label = frameLabel(frames, f);
        if (f.status === 'drawing' || !f.hash) {
          return (
            <span
              key={`drawing-${f.purpose}-${f.attempt ?? 0}`}
              className="sc-sb-tile"
              data-drawing
              role="img"
              aria-label={`${label}, drawing`}
            >
              <span className="sc-shimmer" aria-hidden />
              {since && <RunningTag since={since} />}
            </span>
          );
        }
        const hash = f.hash;
        const isCover = hash === cover;
        return (
          <span key={hash} className="sc-sb-tilewrap">
            <button
              type="button"
              className="sc-sb-tile"
              data-active={hash === selected ? 'true' : undefined}
              aria-pressed={hash === selected}
              aria-label={`${label}${isCover ? ', cover' : ''}`}
              onClick={() => onSelect(hash)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                const tiles = Array.from(
                  e.currentTarget.closest('.sc-sb-board')?.querySelectorAll<HTMLButtonElement>('button.sc-sb-tile') ??
                    [],
                );
                const at = tiles.indexOf(e.currentTarget);
                const next = tiles[at + (e.key === 'ArrowRight' ? 1 : -1)];
                if (next) {
                  e.preventDefault();
                  next.focus();
                }
              }}
            >
              <img src={thumbUrl(hash, 'micro')} alt="" loading="lazy" decoding="async" />
              {isCover && (
                <span className="sc-sb-tilecover" aria-hidden>
                  Cover
                </span>
              )}
            </button>
            {onRetry && f.origin === 'view' && (
              <button
                type="button"
                className="sc-cardpuck sc-sb-puck"
                aria-label={`Draw ${label.toLowerCase()} again`}
                onClick={() => onRetry(hash)}
              >
                <ArrowClockwise size={12} />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
