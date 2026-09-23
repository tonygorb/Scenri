import type { ReactNode } from 'react';
import { X } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { thumbUrl } from '../api.js';

/**
 * Unfinished work, offered back: a presenter half cast, a scene still drawing
 * or drawn and not yet used.
 *
 * Creation is minutes of drawing, and the work it produces used to be
 * reachable only from the page it was started on: leave that page and a
 * finished face, or a scene drawn while you were elsewhere, sat with no door
 * to it. The card is that door.
 *
 * It sits in the same wall as the finished cards, first, so the page does not
 * change shape when a draft becomes the real thing. What marks it out is the
 * caption, which is always visible here and hover-revealed on a finished card:
 * a card whose job is to say "this is not done" cannot hide that behind a
 * pointer.
 *
 * One tap opens it, where a finished card on touch takes two. That is not an
 * inconsistency: the finished card arms on the first tap because it has a
 * second action to reveal and no hover to reveal it with. This has one thing
 * you can do, so asking for a tap to reveal it and another to take it would be
 * friction for nothing. Discard is a press of its own, always there.
 */
export function DraftCard({
  id,
  name,
  hash,
  drawing,
  state,
  href,
  blank,
  onDiscard,
}: {
  id: string;
  name: string;
  hash: string | null | undefined;
  drawing: boolean;
  /** Where it stands, in words: "Drawing", "Face ready", "Drawn, not saved yet". */
  state: string;
  href: string;
  /** What stands in for the picture before there is one. */
  blank: ReactNode;
  onDiscard?: (id: string) => void;
}) {
  return (
    <div className="sc-lookcard" data-variant="plain" data-size="grid" data-build data-building={drawing || undefined}>
      <Link className="sc-lookcard-media" to={href} aria-label={`Continue ${name}`}>
        {hash ? <img src={thumbUrl(hash, 'tile')} alt="" /> : <span className="sc-lookcard-blank">{blank}</span>}
        {drawing && <span className="sc-shimmer" aria-hidden />}
        {/* Said on the picture, because the picture is what makes one of these
            look finished: a face or a place on a card reads as done until
            something on it says otherwise. */}
        <span className="sc-draftmark">Draft</span>
      </Link>
      {onDiscard && (
        <button type="button" className="sc-cardpuck" aria-label={`Discard ${name}`} onClick={() => onDiscard(id)}>
          <X size={13} />
        </button>
      )}
      <span className="sc-lookcard-cap">
        <b dir="auto">{name}</b>
        <span>{state}</span>
      </span>
    </div>
  );
}
