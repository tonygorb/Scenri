import type { Attachment } from './brief.js';

/**
 * Identity before context before direction before taste. Under a tight engine
 * cap what survives is what the image would be *wrong* without: the product,
 * then the person. A style reference is the first thing worth losing.
 *
 * A hand-attached reference outranks the scene: the user chose that exact
 * picture for this shot, where a scene plate is conditioning the recipe
 * derived. On a four-slot engine carrying product + presenter + mark +
 * scene + reference, the scene is what degrades to prose — quietly, by
 * design — never the image someone attached on purpose.
 */
/**
 * How a seat is handed out when attachments outnumber seats: in the brief's
 * own order, whatever the kind. Every chip the user placed, a product, a
 * person, a scene, a reference, a mark, is one group, and the first ones in
 * the line are the pictured ones, so moving a chip earlier moves its photo
 * into the frame and the dimmed chips are always the trailing ones. Only
 * direction and taste, which are not chips anyone placed, rank behind.
 * On a refinement the merge indexes own attachments ahead of carried ones,
 * so the user's newest instruction still outranks what is carried.
 */
const SEAT_TIER: Record<Attachment['role'], number> = {
  brand: 0,
  reference: 0,
  product: 0,
  character: 0,
  scene: 0,
  composition: 1,
  style: 2,
};

export const ROLE_PRIORITY: Record<Attachment['role'], number> = {
  product: 0,
  character: 1,
  brand: 2,
  reference: 3,
  scene: 4,
  composition: 5,
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
 * Two passes fix exactly that, and nothing else:
 *   1. one seat for each attachment group, in seat order (see SEAT_TIER: every
 *      chip in the brief's own order, then direction and taste) — every
 *      distinct thing the user attached gets a seat before any group gets a
 *      second one, and an essential that finds no seat lands in `dropped` so
 *      the caller's refusal path fires unchanged;
 *   2. whatever room remains goes back to corroboration one group at a time,
 *      round-robin — a second product angle, then the presenter's second view,
 *      then the product's third. The old order handed all leftovers out by role
 *      priority, so on a four-slot engine product angle #2 AND #3 both boarded
 *      before the presenter's second view, and the one identity that most needs
 *      corroboration — a face — was the one that lost it. A roomy engine still
 *      reads every angle it used to.
 *
 * A group is one chip's worth of images: a product's angles, a presenter's
 * views, a lone reference or mark. `kept` comes back re-sorted by the old rule
 * so downstream consumers (role directives, codex's per-role ref naming and
 * its counters) see the ordering discipline they always have.
 */
export function allocateAttachments(
  attachments: Attachment[],
  cap: number,
): { kept: Attachment[]; dropped: Attachment[]; seated: Attachment[] } {
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

  // No essentials-first pass any more. The compiler marks every product and
  // person essential, so that pass ranked every product before any face
  // whatever the brief said, and a scene or a mark placed first could never
  // be pictured ahead of them. A seat per group in seat order gives each
  // group its first image, which is the essential one; an essential that
  // still finds no seat lands in `dropped` exactly as before, so the caller's
  // refusal path fires unchanged.
  const seatOrder = [...indexed].sort((x, y) => SEAT_TIER[x.a.role] - SEAT_TIER[y.a.role] || x.i - y.i);
  for (const x of seatOrder) {
    if (kept.size >= max) break;
    if (!kept.has(x.i) && !keptGroups.has(groupOf(x.a))) admit(x);
  }
  // Round-robin the leftovers per group rather than draining one role first:
  // groups take turns in legacy order, one image per turn.
  const queues = new Map<string, { a: Attachment; i: number }[]>();
  for (const x of legacyOrder) {
    if (kept.has(x.i)) continue;
    const g = groupOf(x.a);
    if (!queues.has(g)) queues.set(g, []);
    queues.get(g)!.push(x);
  }
  let admitted = true;
  while (kept.size < max && admitted) {
    admitted = false;
    for (const queue of queues.values()) {
      if (kept.size >= max) break;
      const x = queue.shift();
      if (x) {
        admit(x);
        admitted = true;
      }
    }
  }

  return {
    kept: legacyOrder.filter((x) => kept.has(x.i)).map((x) => x.a),
    dropped: legacyOrder.filter((x) => !kept.has(x.i)).map((x) => x.a),
    // The same images in the order the brief placed them, for a caller that
    // will allocate again: `kept` is re-sorted by role for the consumers
    // below, and feeding that back into a second, tighter allocation put
    // every product ahead of every face on a refinement whatever the line
    // said.
    seated: seatOrder.filter((x) => kept.has(x.i)).map((x) => x.a),
  };
}

/**
 * Fit a refinement's own attachments plus what it inherits from the shot it
 * refines into one budget.
 *
 * One allocation, not a concat-and-slice: the borrowed identity used to be
 * appended after the brief's own references and cut at the cap, which under a
 * tight budget dropped an inherited brand mark or reference with no fairness
 * at all. Own attachments board with their insertion order ahead of the
 * inherited ones (the user's newest instruction outranks what is carried),
 * and duplicates collapse to the OWN copy so re-attaching a carried image
 * never costs a second slot.
 */
export function mergeEditAttachments(
  own: Attachment[],
  inherited: Attachment[],
  cap: number,
): { kept: Attachment[]; dropped: Attachment[] } {
  const seen = new Set(own.map((a) => a.hash));
  const borrowed = inherited.filter((a) => !seen.has(a.hash)).map((a) => ({ ...a, inherited: true }));
  return allocateAttachments([...own, ...borrowed], cap);
}
