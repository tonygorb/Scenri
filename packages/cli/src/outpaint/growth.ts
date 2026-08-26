/**
 * How far a frame may be grown in one go, and what to do when the answer is
 * "further than that".
 *
 * Nothing bounded this before. `defaultReshapeOp` sends 16:9 to 9:16 down the
 * extend path, and for a 1600x900 picture that asks one pass to grow the height
 * to 2844: a factor of 3.16, where published practice puts the reliable band at
 * 25 to 50 percent and multi-stage advice starts around 512 new pixels a side.
 * The request could not succeed and nothing said so.
 *
 * The rule here is deliberately conservative about pixels. Preservation beats
 * composition, so crop assist is the only place an extend discards anything, it
 * engages only past a hard threshold, it is capped, and the caller is expected
 * to say so in the hint rather than do it quietly.
 */

/** Above this, one pass is asking the engine to invent more than it can see. */
export const SINGLE_PASS_MAX = 1.5;
/** Above this, growth alone cannot get there and the other axis has to give. */
export const CROP_ASSIST_ABOVE = 2.0;
/** The most of the other axis crop assist may ever take. */
export const CROP_ASSIST_MAX = 0.15;
/** How much one stage may grow, when staging is used. */
export const STAGE_MAX = 1.4;

export interface GrowthPlan {
  /** Target axis length over source axis length, before any crop assist. */
  growth: number;
  /** Which axis has to grow to reach the target ratio. */
  axis: 'width' | 'height';
  /** How many passes this ought to take. 1 means a single pass is fine. */
  stages: number;
  /**
   * The crop to take from the *other* axis first, as a fraction of it, so the
   * growth lands under `CROP_ASSIST_ABOVE`. Zero for every ordinary reshape.
   */
  cropAssist: number;
  /** Growth after crop assist, which is what the engine is actually asked for. */
  effective: number;
}

/**
 * Decide how a source has to change shape to reach a ratio.
 *
 * Returns null when the picture is already that shape, matching `planExpand`'s
 * one percent tolerance so the two agree about what counts as no-op.
 */
export function planGrowth(source: { width: number; height: number }, targetRatio: number): GrowthPlan | null {
  if (!(source.width > 0 && source.height > 0 && targetRatio > 0)) return null;
  const current = source.width / source.height;
  if (Math.abs(current - targetRatio) / targetRatio < 0.01) return null;

  const axis: 'width' | 'height' = targetRatio > current ? 'width' : 'height';
  const growth = axis === 'width' ? targetRatio / current : current / targetRatio;

  // Crop assist trades a little of the axis that is not growing for a lot less
  // growth on the one that is, because the ratio is the quotient of the two.
  // Taking c off the other axis divides the required growth by 1/(1 - c).
  let cropAssist = 0;
  if (growth > CROP_ASSIST_ABOVE) {
    const wanted = 1 - CROP_ASSIST_ABOVE / growth;
    cropAssist = Math.min(CROP_ASSIST_MAX, wanted);
  }
  const effective = growth * (1 - cropAssist);
  const stages = effective <= SINGLE_PASS_MAX ? 1 : Math.ceil(Math.log(effective) / Math.log(STAGE_MAX));
  return { growth, axis, stages, cropAssist, effective };
}

/**
 * The crop to take before growing, in source pixels.
 *
 * Centred, because this runs before placement decides where the picture sits in
 * the new frame, and because a crop that also moved the subject would be two
 * decisions wearing one name.
 */
export function cropAssistWindow(
  source: { width: number; height: number },
  plan: GrowthPlan,
): { left: number; top: number; width: number; height: number } | null {
  if (plan.cropAssist <= 0) return null;
  if (plan.axis === 'width') {
    const height = Math.max(1, Math.round(source.height * (1 - plan.cropAssist)));
    return { left: 0, top: Math.floor((source.height - height) / 2), width: source.width, height };
  }
  const width = Math.max(1, Math.round(source.width * (1 - plan.cropAssist)));
  return { left: Math.floor((source.width - width) / 2), top: 0, width, height: source.height };
}
