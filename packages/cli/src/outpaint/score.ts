/**
 * How far the two sides of a join actually sit apart, in levels.
 *
 * `seamScore` answers a different question: it divides the step at the join by
 * the picture's own grain, so it says whether the join reads as texture or as a
 * drawn line. That normalisation is what makes it useful on a busy surface and
 * useless on a flat one, and it means the number cannot be compared with
 * anything outside this repo.
 *
 * This is the plain measurement to sit beside it — the mean absolute channel
 * difference between a sample just inside the picture and a sample just as far
 * outside it. It is the same measure the open outpainting implementations use,
 * with the same published reading: under about six is invisible at normal
 * viewing distance, over about fifteen is clearly visible.
 *
 * Two numbers rather than one because they fail in opposite directions. A flat
 * studio sweep has no grain to divide by, so `seamScore` gives up and returns
 * 1 while a real tonal step sits there in plain sight; a heavily textured
 * surface can carry a residual of ten without anyone noticing.
 */
import sharp from 'sharp';
import type { ExpandPlan } from '../expandRules.js';
import { SEAM_VISIBLE } from '../seamScore.js';

/** How far either side of the join to sample. Close enough to be the join, far
 *  enough to miss the single line the reconciliation pins exactly. */
const OFFSET = 4;

/** Below this the join is invisible at normal viewing distance. */
export const RESIDUAL_INVISIBLE = 6;
/** Above this it is visible without being looked for. */
export const RESIDUAL_VISIBLE = 15;

export async function seamResidual(
  image: Buffer,
  plan: ExpandPlan,
  source: { width: number; height: number },
): Promise<number> {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const ch = info.channels;
  const horizontal = plan.axis === 'width';

  /** Mean absolute difference between two columns (or two rows). */
  const between = (a: number, b: number): number | null => {
    const limit = horizontal ? W : H;
    if (a < 0 || b < 0 || a >= limit || b >= limit) return null;
    const run = horizontal ? H : W;
    let sum = 0;
    for (let i = 0; i < run; i++) {
      const ia = (horizontal ? i * W + a : a * W + i) * ch;
      const ib = (horizontal ? i * W + b : b * W + i) * ch;
      sum +=
        Math.abs(data[ia] - data[ib]) + Math.abs(data[ia + 1] - data[ib + 1]) + Math.abs(data[ia + 2] - data[ib + 2]);
    }
    return sum / (run * 3);
  };

  const near = horizontal ? plan.left : plan.top;
  const far = near + (horizontal ? source.width : source.height);

  const both = [
    // The margin before the picture starts, against the picture just inside it.
    between(near - OFFSET, near + OFFSET - 1),
    // The picture just before it ends, against the margin just after.
    between(far - OFFSET, far + OFFSET - 1),
  ].filter((v): v is number => v !== null);

  return both.length ? Math.max(...both) : 0;
}

/**
 * One number to rank candidate draws by, with both measurements at their own
 * scale: 1 is the threshold on either, so a draw that is fine on one and awful
 * on the other does not win on the average.
 */
export function seamPenalty(score: number, residual: number): number {
  return Math.max(score / SEAM_VISIBLE, residual / RESIDUAL_VISIBLE);
}
