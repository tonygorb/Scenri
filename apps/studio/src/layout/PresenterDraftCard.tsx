import { UserCircle } from '@phosphor-icons/react';
import type { PresenterDraftSummary } from '../api.js';
import { DraftCard } from './DraftCard.js';

/** Somebody half cast, offered back: the draft card, in a presenter's words. */
export function PresenterDraftCard({
  draft,
  href,
  onDiscard,
  chosen,
  batching,
  onPick,
  batch,
}: {
  draft: PresenterDraftSummary;
  href: string;
  onDiscard?: (id: string) => void;
  chosen?: boolean;
  batching?: boolean;
  onPick?: (id: string) => void;
  /** Set when this draft is in the pick: the right-click becomes the pick's menu. */
  batch?: { count: number; onAct: () => void } | null;
}) {
  return (
    <DraftCard
      id={draft.id}
      name={draft.name.trim() || 'Untitled presenter'}
      hash={draft.hash}
      drawing={!!draft.drawing}
      state={draftState(draft)}
      href={href}
      blank={<UserCircle size={44} weight="thin" />}
      onDiscard={onDiscard}
      chosen={chosen}
      batching={batching}
      onPick={onPick}
      batch={batch}
    />
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
