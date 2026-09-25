import { useEffect, useState } from 'react';
import { Star } from '@phosphor-icons/react';
import { keptIds, toggleKept, type ShortlistKind } from '../bookmarks.js';
import { Tip } from './Tip.js';

/**
 * The record's keeper. The same shortlist the card already writes, as the
 * star the card and the shot already use: the words live in the tooltip, and
 * gold is the glyph when it is on. Not `data-on`. That paints the icon
 * button's raised fill, which would make a keeper look selected.
 */
export function RecordKeep({ kind, brandId, id }: { kind: ShortlistKind; brandId: string; id: string }) {
  const [kept, setKept] = useState(() => keptIds(kind, brandId).includes(id));
  useEffect(() => {
    setKept(keptIds(kind, brandId).includes(id));
  }, [kind, brandId, id]);

  const label = kept ? 'Remove from Keepers' : 'Add to Keepers';
  return (
    <Tip label={label}>
      <button
        type="button"
        className="sc-icon-btn sc-lookpage-keep"
        data-kept={kept || undefined}
        aria-pressed={kept}
        aria-label={label}
        onClick={() => setKept(toggleKept(kind, brandId, id).includes(id))}
      >
        <Star size={15} weight={kept ? 'fill' : 'regular'} />
      </button>
    </Tip>
  );
}
