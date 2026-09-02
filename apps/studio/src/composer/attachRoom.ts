import type { BriefPreview } from '../apiTypes.js';

/**
 * How many more photo-bearing chips the engine can carry, read off the
 * compiler's own preview rather than re-deriving its budget here.
 *
 * The allocator seats one image per group before any group gets a second
 * angle, and a group is one chip's worth: a product, a person, a mark, a
 * reference, a scene plate. So the room is the cap less the distinct groups
 * the compile produced, kept and budget-dropped alike; a dropped identity
 * that simply has no photo never held a slot and does not count. An engine
 * that reads no images (cap 0) has no room to run out of: its chips are
 * words, and refusing them would refuse the brief.
 */
export function attachRoom(preview: Pick<BriefPreview, 'cap' | 'attachments' | 'dropped'> | null): {
  cap: number;
  left: number;
} | null {
  if (!preview || preview.cap == null || preview.cap <= 0) return null;
  const groups = new Set<string>();
  for (const a of preview.attachments) groups.add(`${a.role}:${a.id ?? a.hash}`);
  for (const d of preview.dropped) if (d.reason !== 'missing') groups.add(`${d.role}:${d.id ?? d.hash}`);
  return { cap: preview.cap, left: preview.cap - groups.size };
}

/**
 * The kinds of chip that are nothing but their picture. A product, a person
 * or a scene carries a written identity too, so it still shapes the shot when
 * its photo finds no seat; a reference or a brand mark has no words to ride
 * on, and past the last seat it is refused rather than quietly dropped.
 */
export const PIXEL_ONLY = new Set(['ref', 'mark']);
