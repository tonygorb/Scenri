import type { BriefPreview } from '../apiTypes.js';

/**
 * How many photo groups the engine pictures per shot, as the compiler's own
 * preview reports it: the engine's slots, less the source frame on a refine.
 * Null for an engine that reads no images (its chips are words) and for an
 * older server that says nothing about its cap.
 */
export function photoCap(preview: Pick<BriefPreview, 'cap'> | null): number | null {
  if (!preview || preview.cap == null || preview.cap <= 0) return null;
  return preview.cap;
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
 * The most identities one shot carries, pictured and described together.
 * Measured on codex: ten identities compiled to 11.4k prompt characters and
 * rendered in 155s, nineteen compiled to 19.8k and hit the 300s watchdog.
 * Twelve keeps a full brief well inside the window; raise it only after the
 * compiler says less per described identity.
 */
export const IDENTITY_CAP = 12;

/**
 * What every door says at the ceiling, in one short line: what is true, and
 * what to do. The tooltip on a dimmed card or tile, the live region when a
 * pick is refused.
 */
export const CEILING_SENTENCE = `Shot is full: ${IDENTITY_CAP} identities. Remove one to add another.`;
