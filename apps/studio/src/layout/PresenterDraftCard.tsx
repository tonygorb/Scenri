import { UserCircle, X } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { type PresenterDraftSummary, thumbUrl } from '../api.js';

/**
 * Somebody half cast, offered back.
 *
 * Creation is minutes of drawing, and the work it produces used to be
 * reachable only from the tab it was started in: close that tab and a finished
 * face, a full body and four more views sat in the library with no door to
 * them. The card is that door.
 *
 * It sits in the same wall as the finished people, first, the way a scene
 * being built does, so the page does not change shape when a draft becomes a
 * presenter. What marks it out is the caption, which is always visible here
 * and hover-revealed on a finished card: a card whose job is to say "this is
 * not done" cannot hide that behind a pointer.
 *
 * One tap opens it, where a finished card on touch takes two. That is not an
 * inconsistency: the finished card arms on the first tap because it has a
 * second action to reveal and no hover to reveal it with. This has one thing
 * you can do, so asking for a tap to reveal it and another to take it would be
 * friction for nothing. Discard is a press of its own, always there.
 */
export function PresenterDraftCard({
  draft,
  href,
  onDiscard,
}: {
  draft: PresenterDraftSummary;
  href: string;
  onDiscard?: (id: string) => void;
}) {
  const name = draft.name.trim() || 'Untitled presenter';
  return (
    <div
      className="sc-lookcard"
      data-variant="plain"
      data-size="grid"
      data-build
      data-building={draft.drawing || undefined}
    >
      <Link className="sc-lookcard-media" to={href} aria-label={`Continue ${name}`}>
        {draft.hash ? (
          <img src={thumbUrl(draft.hash, 'tile')} alt="" />
        ) : (
          <span className="sc-lookcard-blank">
            <UserCircle size={44} weight="thin" />
          </span>
        )}
        {draft.drawing && <span className="sc-shimmer" aria-hidden />}
        {/* Said on the picture, because the picture is what makes one of these
            look finished: a face on a card reads as a presenter until
            something on it says otherwise. */}
        <span className="sc-draftmark">Draft</span>
      </Link>
      {onDiscard && (
        <button
          type="button"
          className="sc-cardpuck"
          aria-label={`Discard ${name}`}
          onClick={() => onDiscard(draft.id)}
        >
          <X size={13} />
        </button>
      )}
      <span className="sc-lookcard-cap">
        <b dir="auto">{name}</b>
        <span>{draftState(draft)}</span>
      </span>
    </div>
  );
}

/**
 * How far along they are, in words rather than a step count.
 *
 * "Step 4 of 9" tells somebody about our questions; what they want to know is
 * whether the expensive part survived.
 */
export function draftState(d: PresenterDraftSummary): string {
  if (d.drawing) return 'Drawing';
  // A picture with nothing approved is a face waiting on a decision, which is
  // not the same as nothing having been drawn: the card shows it, so the words
  // beside it cannot say there is nothing there.
  if (!d.approved) return d.hash ? 'A face to decide' : d.source === 'photos' ? 'Photos added' : 'Not drawn yet';
  if (d.approved === 1) return 'Face ready';
  if (d.approved >= d.of) return 'Ready to save';
  return `${d.approved} of ${d.of} views ready`;
}
