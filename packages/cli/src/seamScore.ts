import sharp from 'sharp';
import type { ExpandPlan } from './expandRules.js';

/**
 * How badly a grown frame shows its join, in units of the picture's own grain.
 *
 * The number is the jump across the seam line divided by the ordinary
 * row-to-row variation a little either side of it. A perfectly continued
 * surface scores about 1: the join is no more of a step than the texture makes
 * on its own. A visible line scores several times that.
 *
 * It exists because the engine we ship by default has no seed. The same shot,
 * grown twice, returns two different margins — measured three times over on one
 * unchanged picture, the join came back at 2.8, then 15.1, then 2.1. Nothing in
 * the prompt controls that, so the only honest way to hold a standard is to
 * look at the answer and say whether it is good enough.
 */
export async function seamScore(image: Buffer, plan: ExpandPlan, source: { width: number; height: number }) {
  const { data, info } = await sharp(image).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const horizontal = plan.axis === 'width';

  /** Mean absolute difference across one column (or row) and the one before it. */
  const line = (i: number): number => {
    let sum = 0;
    if (horizontal) {
      if (i < 1 || i >= W) return 0;
      for (let y = 0; y < H; y++) sum += Math.abs(data[y * W + i] - data[y * W + i - 1]);
      return sum / H;
    }
    if (i < 1 || i >= H) return 0;
    for (let x = 0; x < W; x++) sum += Math.abs(data[i * W + x] - data[(i - 1) * W + x]);
    return sum / W;
  };

  const at = (seam: number): number => {
    const near: number[] = [];
    for (let d = 6; d <= 30; d++) {
      near.push(line(seam - d));
      near.push(line(seam + d));
    }
    const ordinary = near.reduce((a, b) => a + b, 0) / near.length;
    // A flat margin has no grain to divide by; treat that as no evidence of a
    // seam rather than as an infinite one.
    if (ordinary < 0.05) return 1;
    return line(seam) / ordinary;
  };

  const first = horizontal ? plan.left : plan.top;
  const second = first + (horizontal ? source.width : source.height);
  return Math.max(at(first), at(second));
}

/**
 * Above this, the join reads as a drawn line rather than as texture.
 *
 * Taken from the measurements rather than chosen: joins a reviewer called
 * invisible sat between 0.9 and 1.7, ones called findable at 2.1 to 2.9, and
 * ones obvious at a glance from 3.5 up.
 */
export const SEAM_VISIBLE = 2.2;
