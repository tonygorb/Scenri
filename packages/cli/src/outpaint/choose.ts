/**
 * Which of the two frames to ship.
 *
 * An extend on an engine with no mask can be assembled two ways from two draws,
 * and the battery of 2026-08-26 measured both across six shots:
 *
 *   PRESERVED  the original composited back over a generated surround. Every
 *              source pixel survives byte for byte — and the join is sometimes
 *              visible, because two renderings of the same scene disagree along
 *              a straight line and the eye is superb at finding that.
 *   REFRAMED   the engine's own frame, kept whole. No join exists to find,
 *              because nothing was pasted — and the photograph is no longer
 *              exactly the photograph, because the model redrew it.
 *
 * Neither wins everywhere, and that is the whole point. Measured seam on the
 * preserved frame, by shot: clay 0.86, studio 0.77, logo 0.79, pair 0.79,
 * lowkey 1.19 — all invisible, and all of them therefore free: exact pixels at
 * no cost. Then presenter, a tight crop of a room where the margin has to
 * invent architecture that lines up with the original's perspective: 7.65,
 * against a visible threshold of 2.2. That one shot is the complaint.
 *
 * On that same shot the reframed candidate scored 0.95 fidelity at a seam of
 * 0.74. So the rule is not a strategy choice, it is a per-shot measurement:
 * take the exact pixels whenever they can be had without a visible join, and
 * give them up only on the shots where keeping them is what shows.
 *
 * Applied to the battery this beats every fixed arm — 0.991 mean fidelity with
 * no visible seam anywhere, against 0.719 for the best always-reframe arm and
 * one visibly stitched shot in six for always-preserve.
 */
import { SEAM_VISIBLE } from '../seamScore.js';

export type ExpandChoice = 'preserved' | 'reframed';

export interface ExpandCandidates {
  /** The original composited back. Null when that assembly could not be built. */
  preserved: { image: Buffer; seam: number } | null;
  /** The engine's own frame. Null when it was unusable or was never drawn. */
  reframed: { image: Buffer } | null;
}

export interface ExpandDecision {
  choice: ExpandChoice;
  image: Buffer;
  /** For the record on the node, and for the battery to read back. */
  reason: 'join-invisible' | 'join-visible' | 'only-candidate';
  seam: number | null;
}

/**
 * Never a coin toss: the preserved frame is preferred and has to earn its way
 * out. Exact pixels are strictly better when nobody can see the join, so the
 * only thing that displaces them is evidence that somebody can.
 */
export function chooseExpand(candidates: ExpandCandidates): ExpandDecision | null {
  const { preserved, reframed } = candidates;
  if (!preserved && !reframed) return null;
  if (!preserved && reframed) {
    return { choice: 'reframed', image: reframed.image, reason: 'only-candidate', seam: null };
  }
  if (preserved && !reframed) {
    return { choice: 'preserved', image: preserved.image, reason: 'only-candidate', seam: preserved.seam };
  }
  // Both present. `seamScore` returns 1 on a surface too flat to judge, which
  // is "no evidence of a join" and therefore keeps the exact pixels — the right
  // way for an undecidable measurement to fail on this path.
  const seam = (preserved as { seam: number }).seam;
  if (seam < SEAM_VISIBLE) {
    return {
      choice: 'preserved',
      image: (preserved as { image: Buffer }).image,
      reason: 'join-invisible',
      seam,
    };
  }
  return {
    choice: 'reframed',
    image: (reframed as { image: Buffer }).image,
    reason: 'join-visible',
    seam,
  };
}
