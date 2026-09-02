import { SitOutTooltip } from '../../composer/SitOutTooltip.js';
import { BookmarkSimple, Check, ImageSquare } from '@phosphor-icons/react';
import type { Candidate } from '../../composer/ingredientOptions.js';

/** What a rail tile needs of a thing: a caption, a title, a picture. A shot is one too. */
export type Tile = Pick<Candidate, 'label' | 'full' | 'thumb' | 'crop' | 'bookmarked'>;

export function AssetCard({
  candidate,
  on,
  named,
  disabled,
  title,
  onClick,
}: {
  candidate: Tile;
  on: boolean;
  named: boolean;
  /**
   * The brief cannot take another identity: the tile sits out, dimmed and
   * inert, and `title` is the sentence its tooltip says. Inert through
   * aria-disabled, because a disabled button takes no pointer events and the
   * tooltip would never open.
   */
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  const tile = (
    <button
      type="button"
      className="sc-acard"
      data-on={on || undefined}
      aria-label={candidate.full}
      aria-pressed={on}
      aria-disabled={disabled || undefined}
      title={disabled ? undefined : candidate.full}
      onClick={disabled ? undefined : onClick}
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
  return <SitOutTooltip why={disabled ? title : null}>{tile}</SitOutTooltip>;
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
