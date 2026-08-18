import { BookmarkSimple, Check, ImageSquare } from '@phosphor-icons/react';
import type { Candidate } from '../../composer/ingredientOptions.js';

export function AssetCard({
  candidate,
  on,
  named,
  onClick,
}: {
  candidate: Candidate;
  on: boolean;
  named: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="sc-acard"
      data-on={on || undefined}
      aria-label={candidate.full}
      aria-pressed={on}
      title={candidate.full}
      onClick={onClick}
    >
      <span className="sc-acard-thumb">
        {candidate.thumb ? (
          <img src={candidate.thumb} alt="" loading="lazy" data-crop={candidate.crop} />
        ) : (
          <span className="sc-aswatch" style={{ display: 'grid', placeItems: 'center' }}>
            <ImageSquare size={14} />
          </span>
        )}
        <span className="sc-acard-tick" aria-hidden>
          <Check size={10} weight="bold" />
        </span>
      </span>
      {named && (
        <span className="sc-acard-label">
          {candidate.bookmarked && (
            <>
              <BookmarkSimple className="sc-bm-mark" size={10} weight="fill" aria-hidden />
              <span className="sc-vh">Bookmarked. </span>
            </>
          )}
          {candidate.label}
        </span>
      )}
    </button>
  );
}

/**
 * The shape actually on screen, one fade behind the one asked for.
 *
 * The quick row and the named grid are different DOM — different cell count,
 * different columns, labels or none — so swapping them the instant the state
 * flips reads as a pop, worst of all while the section is also changing
 * height. The content fades out first, the shape swaps underneath while it is
 * invisible, then it fades back in. Reduced motion strips the fade in CSS, so
 * waiting one out there would hold an unexplained blank instead of hiding a
 * swap: it goes straight across.
 */
