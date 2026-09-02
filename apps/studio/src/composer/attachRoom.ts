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
  for (const a of preview.attachments) groups.add(groupKey(a.role, a.id ?? a.hash));
  for (const d of preview.dropped) if (d.reason !== 'missing') groups.add(groupKey(d.role, d.id ?? d.hash));
  return { cap: preview.cap, left: preview.cap - groups.size };
}

/**
 * The groups whose photo the budget left out: these identities reach the
 * engine as words. Keyed the way the allocator keys a group, so a chip can
 * ask about itself by role and id (or hash, for a reference or a mark).
 */
export function describedKeys(preview: Pick<BriefPreview, 'cap' | 'attachments' | 'dropped'> | null): Set<string> {
  const out = new Set<string>();
  if (!preview || preview.cap == null || preview.cap <= 0) return out;
  const kept = new Set(preview.attachments.map((a) => groupKey(a.role, a.id ?? a.hash)));
  for (const d of preview.dropped) {
    const k = groupKey(d.role, d.id ?? d.hash);
    if (d.reason !== 'missing' && !kept.has(k)) out.add(k);
  }
  return out;
}

export const groupKey = (role: string, id: string) => `${role}:${id}`;

/** The chip kinds that are identities: each is one group to the allocator and counts toward the ceiling. */
export const IDENTITY_KINDS = new Set(['product', 'character', 'ref', 'mark', 'template']);

/**
 * The kinds that are nothing but their picture. A product, a person or a
 * scene carries a written identity too, so it still shapes the shot when its
 * photo finds no seat; a reference or a brand mark has no words to ride on,
 * and past the last seat it is refused rather than quietly dropped.
 */
export const PIXEL_ONLY = new Set(['ref', 'mark']);

/**
 * The most identities one shot carries, pictured and described together.
 * Measured on codex: ten identities compiled to 11.4k prompt characters and
 * rendered in 155s, nineteen compiled to 19.8k and hit the 300s watchdog.
 * Twelve keeps a full brief well inside the window; raise it only after the
 * compiler says less per described identity.
 */
export const IDENTITY_CAP = 12;

/**
 * What every door says at the ceiling: what is true, and what to do. The
 * same sentence above the attach panel's dimmed cards, in the live region
 * when a pick is refused, so a dimmed grid never has to explain itself.
 */
export const CEILING_SENTENCE = `This shot already holds ${IDENTITY_CAP} identities, the most one can carry. Remove a chip to add another.`;
