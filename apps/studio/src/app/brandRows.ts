import type { Brand } from '../api.js';

/**
 * How answers about brands become the one list every surface reads.
 *
 * Owned presenters, scenes and manual products, the logos and the palette all
 * live inside the brand document, and the shell holds that document once. Two
 * kinds of answer write to it, and they can arrive in any order:
 *
 * - a mutation's own answer, one row, applied the moment it lands;
 * - a re-read of the whole list, which a build landing, a create or a settings
 *   save asks for, and which can be out for seconds.
 *
 * A late answer must never put back what a newer one removed. A deleted scene
 * that returns because a list read started before the delete is the bug this
 * file exists to make impossible.
 */

/**
 * Whether a row may replace the one held for the same brand.
 *
 * The server stamps `updatedAt` on every write in milliseconds, so two
 * mutation answers that crossed on the way back are ordered by the write they
 * describe. Only a strictly older row is refused: an equal stamp is the same
 * write. The same rule as `acceptsDraft` for presenter drafts.
 */
export function acceptsBrand(cur: Brand | undefined, next: Brand): boolean {
  return !cur || next.updatedAt >= cur.updatedAt;
}

/**
 * One brand's row, as a mutation just answered it, put into the list.
 *
 * Only a brand already in the list is replaced: creating and deleting brands
 * go through a list re-read, which is what decides which brands exist.
 */
export function applyBrandRow(list: Brand[], next: Brand): Brand[] {
  const at = list.findIndex((b) => b.id === next.id);
  if (at < 0 || list[at] === next || !acceptsBrand(list[at], next)) return list;
  const out = list.slice();
  out[at] = next;
  return out;
}

/**
 * A re-read of the whole list, merged with what was applied while it was out.
 *
 * The read decides which brands exist and, for every row nobody touched since
 * it started, what they hold. That half needs no clock at all, so a machine
 * whose clock stepped backwards still converges on the next read.
 *
 * A row that a mutation answer replaced after the read started (`touched`) was
 * written after anything the read could have seen, unless the read carries a
 * strictly newer stamp for it, which means yet another write landed in
 * between. So the held row stays, and the read's row wins only when newer.
 */
export function mergeBrandList(cur: Brand[] | null, answer: Brand[], touched: ReadonlySet<string>): Brand[] {
  if (!cur) return answer;
  const held = new Map(cur.map((b) => [b.id, b]));
  let same = cur.length === answer.length;
  const out = answer.map((b, i) => {
    const mine = held.get(b.id);
    const row = mine && touched.has(b.id) && !(b.updatedAt > mine.updatedAt) ? mine : b;
    if (row !== cur[i]) same = false;
    return row;
  });
  return same ? cur : out;
}
