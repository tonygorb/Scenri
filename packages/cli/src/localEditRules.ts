/**
 * When is a change small enough, and contained enough, to keep the rest of the
 * photograph?
 *
 * The scope classifier reads the user's words and decides what to ask the
 * engine for. This reads the picture that came back and decides whether the
 * answer can be trusted as a local change. The two are deliberately separate:
 * words can be wrong, so the evidence gets its own vote, and a "local" edit
 * that turns out to have moved half the frame is treated as the whole frame
 * change it evidently was.
 *
 * All of it is fractions of the frame rather than pixel counts, so the same
 * numbers hold at every resolution.
 */

/** Below this, the engine did nothing worth keeping the rest of the frame for. */
export const MIN_CHANGED = 0.0005;

/**
 * Above this, the engine re-rendered rather than edited.
 *
 * Splicing two different renders together puts a seam through the middle of a
 * picture, which is worse than an honest re-render, so the raw answer is kept
 * instead. Measured refinements sit well below it: adding a prop moved 2.5
 * percent of the frame and removing an object 11.6 percent, while asking for
 * nighttime moved 38.4 percent.
 */
export const MAX_CHANGED = 0.25;

/**
 * A change spread across the whole frame is not a local change even when it is
 * a small fraction of it. A regrade nudges every pixel slightly; so does a
 * resize round trip. Both look tiny by area and cover the entire picture.
 */
export const MAX_SPREAD = 0.85;

export type LocalEditOutcome =
  | 'composited'
  | 'no-change'
  | 'too-much-changed'
  | 'scattered'
  | 'shape-changed'
  | 'error';

export interface ChangeShape {
  /** Fraction of the frame whose pixels moved. */
  changed: number;
  /** Fraction of the frame covered by the bounding box around those pixels. */
  spread: number;
}

/**
 * Decide whether to keep the rest of the source, given what actually moved.
 *
 * Returns the outcome to record either way, because the number is worth having
 * even when nothing is composited: it is the only measurement of how often a
 * given engine really edits rather than re-renders.
 */
export function judgeChange(shape: ChangeShape): LocalEditOutcome {
  if (!(shape.changed > 0) || shape.changed < MIN_CHANGED) return 'no-change';
  if (shape.changed > MAX_CHANGED) return 'too-much-changed';
  if (shape.spread > MAX_SPREAD && shape.changed < 0.2) return 'scattered';
  return 'composited';
}

/**
 * How far to grow the changed region before compositing.
 *
 * A new object is not the only thing that moved: it casts a shadow, it reflects
 * in the surface under it, and it darkens where it touches. Those live outside
 * the pixels that strictly changed, and a mask tight to the object leaves them
 * behind on the wrong side of the seam. Two percent of the long edge is enough
 * for contact shading without swallowing half the frame.
 */
export function dilationFor(longEdge: number): number {
  return Math.max(6, Math.round(longEdge * 0.02));
}
