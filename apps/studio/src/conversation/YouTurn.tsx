import { PencilSimple } from '@phosphor-icons/react';
import { thumbUrl } from '../api.js';
import { Tip } from '../layout/Tip.js';

/**
 * Your answer: a bubble on the right, under the line it answered, and a
 * pencil when it can still be changed. Photographs in
 * an answer show as a row of small frames inside the bubble.
 */
export function YouTurn({
  text,
  photos,
  editable,
  first,
  arrive,
  onEdit,
}: {
  text: string;
  photos?: string[];
  editable?: boolean;
  /** The first answer carries the "You" word; the rest are told by their side. */
  first?: boolean;
  /** New this render: fade and rise into place. */
  arrive?: boolean;
  onEdit?: () => void;
}) {
  return (
    <div className="sc-convo-turn" data-who="you" data-arrive={arrive || undefined}>
      {first && <span className="sc-convo-who">You</span>}
      <div className="sc-convo-bubble">
        {editable && onEdit && (
          <Tip label="Change this answer">
            <button type="button" className="sc-convo-edit" aria-label="Change this answer" onClick={onEdit}>
              <PencilSimple size={13} />
            </button>
          </Tip>
        )}
        <p>{text}</p>
        {photos && photos.length > 0 && (
          <div className="sc-convo-photos">
            {photos.map((h, i) => (
              <img key={h} src={thumbUrl(h, 'micro')} alt={`Yours, ${i + 1} of ${photos.length}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
