import { Star } from '@phosphor-icons/react';
import { useState } from 'react';
import { keptIds, type ShortlistKind, toggleKept } from '../bookmarks.js';
import { Tip } from './Tip.js';

/**
 * Keepers on a record's own page: one icon button beside its pencil, the same
 * on a scene, a presenter and a product page, and for yours and Scenri's alike,
 * because every card in their libraries offers it. The star a kept card wears,
 * lit the same way; the tip says what a press does. A page reused for another
 * record reads that record's state, not the last one's.
 */
export function KeepButton({ kind, brandId, id }: { kind: ShortlistKind; brandId: string; id: string }) {
  const [pressed, setPressed] = useState<{ id: string; on: boolean } | null>(null);
  const kept = pressed?.id === id ? pressed.on : keptIds(kind, brandId).includes(id);
  const label = kept ? 'Remove from Keepers' : 'Add to Keepers';
  return (
    <Tip label={label}>
      <button
        type="button"
        className="sc-icon-btn sc-keep-btn"
        data-on={kept || undefined}
        aria-pressed={kept}
        aria-label={label}
        onClick={() => setPressed({ id, on: toggleKept(kind, brandId, id).includes(id) })}
      >
        <Star size={17} weight={kept ? 'fill' : 'regular'} />
      </button>
    </Tip>
  );
}
