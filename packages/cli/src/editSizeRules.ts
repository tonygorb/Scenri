/**
 * Whether an edit's answer keeps the canvas it was given.
 *
 * A plain refinement's answer should be the same picture at the same size, and
 * engines are now told so — but none of them promises it. Codex in particular
 * likes to hand back the same shape at fewer pixels, and a shrunken answer that
 * is stored becomes the next refinement's source, which is how a chain of five
 * "make it warmer"s quietly walked a 1536-pixel shot down to a thumbnail. The
 * aspect check cannot catch this: the ratio is right, only the resolution is
 * gone.
 *
 * So a same-shape answer is judged against the source it edited. Close enough
 * to the source's size and it is resampled back onto the exact source canvas —
 * the same fill resize the local-edit compositor and the expand assembly
 * already perform, an alignment, not an enhancement. Below the floor there is
 * too little picture left to stand on, and pretending otherwise by upscaling
 * would invent detail the engine never drew: that answer is a failed edit and
 * is reported as one.
 */

/** Same-shape tolerance, matching preserveOutsideChange's alignment gate. */
export const SAME_SHAPE_TOL = 0.01;

/**
 * Below this fraction of the source's long edge, a return is a failure rather
 * than drift: resampling a half-resolution answer up to the source canvas
 * would fabricate three quarters of its pixels.
 */
export const SHRINK_FLOOR = 0.8;

export type EditSizeVerdict =
  /** Exact match, unjudgeable input, or a different shape (the aspect check's jurisdiction). */
  | { action: 'keep' }
  /** Same shape, drifted size: resample onto the exact source canvas. */
  | { action: 'resize'; scale: number }
  /** Same shape, below the floor: fail the edit loudly. */
  | { action: 'reject'; scale: number };

export function judgeEditSize(
  src: { width: number; height: number },
  got: { width: number; height: number },
): EditSizeVerdict {
  if (!(src.width > 0 && src.height > 0 && got.width > 0 && got.height > 0)) return { action: 'keep' };
  if (got.width === src.width && got.height === src.height) return { action: 'keep' };

  const want = src.width / src.height;
  const have = got.width / got.height;
  if (Math.abs(have - want) / want > SAME_SHAPE_TOL) return { action: 'keep' };

  const scale = Math.max(got.width, got.height) / Math.max(src.width, src.height);
  if (scale < SHRINK_FLOOR) return { action: 'reject', scale };
  // Larger answers are normalized down too: the thread's canvas is a contract,
  // and "free" pixels the model synthesized past it would make the next
  // refinement's source a different size than the shot the user is looking at.
  return { action: 'resize', scale };
}
