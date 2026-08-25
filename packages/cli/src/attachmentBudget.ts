import type { Attachment } from './brief.js';

/**
 * Identity before context before direction before taste. Under a tight engine
 * cap what survives is what the image would be *wrong* without: the product,
 * then the person. A style reference is the first thing worth losing.
 */
export const ROLE_PRIORITY: Record<Attachment['role'], number> = {
  product: 0,
  character: 1,
  brand: 2,
  scene: 3,
  composition: 4,
  reference: 5,
  style: 6,
};

/**
 * Fit the brief's attachments into an engine's reference budget.
 *
 * The old rule was one sort (essential, then role priority, then insertion) cut
 * at the cap. Its failure: a product contributes up to three angles but only
 * the first is essential, and the sort still ranked angle #2 and #3 at product
 * priority — so on a four-slot engine two corroboration angles evicted the
 * reference or brand mark the user attached by hand. The picture then ignored
 * an explicit instruction to make a subject it already had marginally sharper.
 *
 * Three passes fix exactly that, and nothing else:
 *   1. essentials, in the old order — identity always boards first, and an
 *      essential that still does not fit lands in `dropped` so the caller's
 *      refusal path fires unchanged;
 *   2. one slot for each attachment group not yet represented, in role-priority
 *      order — every distinct thing the user attached gets a seat before any
 *      group gets a second one;
 *   3. whatever room remains goes back to corroboration in the old order, so a
 *      roomy engine still reads every product angle it used to.
 *
 * A group is one chip's worth of images: a product's angles, a presenter's
 * views, a lone reference or mark. `kept` comes back re-sorted by the old rule
 * so downstream consumers (role directives, codex's positional ref naming) see
 * the ordering discipline they always have.
 */
export function allocateAttachments(
  attachments: Attachment[],
  cap: number,
): { kept: Attachment[]; dropped: Attachment[] } {
  const max = Math.max(0, cap);
  const indexed = attachments.map((a, i) => ({ a, i }));
  const legacyOrder = [...indexed].sort(
    (x, y) =>
      Number(!!y.a.essential) - Number(!!x.a.essential) ||
      ROLE_PRIORITY[x.a.role] - ROLE_PRIORITY[y.a.role] ||
      x.i - y.i,
  );

  const groupOf = (a: Attachment) => `${a.role}:${a.id ?? a.hash}`;
  const kept = new Set<number>();
  const keptGroups = new Set<string>();
  const admit = (x: { a: Attachment; i: number }) => {
    kept.add(x.i);
    keptGroups.add(groupOf(x.a));
  };

  for (const x of legacyOrder) {
    if (kept.size >= max) break;
    if (x.a.essential) admit(x);
  }
  for (const x of legacyOrder) {
    if (kept.size >= max) break;
    if (!kept.has(x.i) && !keptGroups.has(groupOf(x.a))) admit(x);
  }
  for (const x of legacyOrder) {
    if (kept.size >= max) break;
    if (!kept.has(x.i)) admit(x);
  }

  return {
    kept: legacyOrder.filter((x) => kept.has(x.i)).map((x) => x.a),
    dropped: legacyOrder.filter((x) => !kept.has(x.i)).map((x) => x.a),
  };
}
