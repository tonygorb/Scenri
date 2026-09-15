/** Enough of a draft to decide whether it may be installed. */
export interface DraftStamp {
  id: string;
  updatedAt: string;
}

/**
 * Whether an answer from the server may become the draft on screen.
 *
 * Two different things can go wrong between asking and being answered, and
 * only one of them was guarded.
 *
 * **The answer is about somebody else.** A read for one draft can land after
 * the page has moved to another: the poll is on a 1.5s clock, a card is a
 * link, and nothing cancelled the read in flight. The old rule compared the
 * row's clock *only when the two ids matched*, so a mismatch fell through to
 * "take it", and the studio installed a draft nobody had asked for, pictures
 * and all. That is the cross-draft contamination.
 *
 * **The answer is older than what is held.** Two reads for the same draft can
 * cross, and the row's own clock decides. This half was always right.
 *
 * `want` is the draft the page is asking about right now, which is the route's
 * own id. Anything else is refused whatever its clock says.
 */
export function acceptsDraft(cur: DraftStamp | null, next: DraftStamp, want: string | null): boolean {
  if (!want || next.id !== want) return false;
  if (cur && cur.id === next.id && next.updatedAt < cur.updatedAt) return false;
  return true;
}
