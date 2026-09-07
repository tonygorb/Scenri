import { Plus } from '@phosphor-icons/react';
import { Spinner } from '@radix-ui/themes';
import { imgUrl, thumbUrl } from '../../api.js';
import type { BoardItem, Candidate } from './studioState.js';

/**
 * The product, large, and its reference board beneath it.
 *
 * The same stage and rail the product page shows an established product
 * with, so what is being made looks like what it becomes. Photographs first,
 * then the views Scenri drew; the stage shows whichever one is selected, or
 * the view being drawn, in the same frame, so nothing moves when it lands.
 * A drawn view is told from a photograph by a hairline under its thumb and
 * a word in the caption, never a badge.
 */
export function StudioBoard({
  board,
  selected,
  candidate,
  candidateLabel,
  elapsed,
  cover,
  uploading,
  onSelect,
  onAdd,
  onRemove,
  onCover,
}: {
  board: BoardItem[];
  selected: string | null;
  candidate: Candidate | null;
  /** The view being drawn or offered, named for a person: "three-quarter". */
  candidateLabel: string;
  /** m:ss since the draw began. */
  elapsed: string;
  cover: string | null;
  uploading: boolean;
  onSelect: (hash: string) => void;
  onAdd: (files: File[]) => void;
  onRemove: (hash: string) => void;
  onCover: (hash: string) => void;
}) {
  const showingCandidate =
    !!candidate && (candidate.stage === 'ready' || candidate.stage === 'queued' || candidate.stage === 'drawing');
  const current = showingCandidate ? null : (board.find((b) => b.hash === selected) ?? board[0] ?? null);
  const canRemove = !!current && (current.source === 'derived' || board.filter((b) => b.source === 'photo').length > 1);

  const pick = (files: FileList | null) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'));
    if (list.length) onAdd(list);
  };

  return (
    <>
      <div className="sc-refstage">
        {candidate && (candidate.stage === 'queued' || candidate.stage === 'drawing') ? (
          <div className="sc-pstudio-drawing" role="status" aria-live="polite">
            <Spinner size="2" />
            <span>Drawing the {candidateLabel} view</span>
            <b>{elapsed}</b>
          </div>
        ) : candidate?.stage === 'ready' && candidate.hash ? (
          <div className="sc-refstage-frame" data-candidate>
            <img src={imgUrl(candidate.hash)} alt={`The drawn ${candidateLabel} view`} />
          </div>
        ) : current ? (
          <div className="sc-refstage-frame">
            <img src={imgUrl(current.hash)} alt="" />
          </div>
        ) : null}
      </div>

      <div className="sc-pstudio-caption">
        {showingCandidate ? (
          candidate?.stage === 'ready' ? (
            <span>The {candidateLabel} view, drawn from the photographs</span>
          ) : null
        ) : current ? (
          <>
            <span>
              {current.source === 'derived'
                ? `Drawn ${labelOf(current.angle)} view`
                : labelOf(current.angle) || 'Photograph'}
              {cover === current.hash ? ' · Cover' : ''}
            </span>
            {cover !== current.hash && (
              <button type="button" className="sc-btn sc-btn-ghost" onClick={() => onCover(current.hash)}>
                Use as cover
              </button>
            )}
            {canRemove && (
              <button type="button" className="sc-btn sc-btn-ghost" onClick={() => onRemove(current.hash)}>
                Remove
              </button>
            )}
          </>
        ) : null}
      </div>

      <div className="sc-refrail-shell">
        <div className="sc-refrail-track">
          <div className="sc-refrail">
            {board.map((b, i) => (
              <button
                key={b.hash}
                type="button"
                className="sc-refrail-item"
                data-on={!showingCandidate && current?.hash === b.hash ? '' : undefined}
                data-source={b.source === 'derived' ? 'derived' : undefined}
                data-cover={cover === b.hash ? '' : undefined}
                aria-label={b.source === 'derived' ? `Drawn ${labelOf(b.angle)} view` : `Photograph ${i + 1}`}
                aria-pressed={!showingCandidate && current?.hash === b.hash}
                onClick={() => onSelect(b.hash)}
              >
                <img src={thumbUrl(b.hash, 'micro')} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
        <label className="sc-refrail-item sc-refrail-add" data-busy={uploading || undefined}>
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={uploading}
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = '';
            }}
          />
          {uploading ? <Spinner size="1" /> : <Plus size={16} weight="bold" />}
          <span className="sc-vh">Add photos</span>
        </label>
      </div>
    </>
  );
}

/** "three-quarter" reads as itself; "lateral-side" reads as "lateral side". */
export function labelOf(angle: string | null | undefined): string {
  if (!angle || angle === 'other') return '';
  if (angle === 'lateral-side') return 'outer side';
  if (angle === 'medial-side') return 'inner side';
  return angle;
}
