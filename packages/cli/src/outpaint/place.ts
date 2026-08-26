/**
 * Where the picture sits in the frame it grew into.
 *
 * `planExpand` centres unconditionally, which is the open finding from the
 * August quality marathon: Scenri adapts the box, not the picture. A bottle
 * already standing near the right edge of a square gets equal new canvas either
 * side of it in the 16:9, so it ends up in the middle of a frame it was never
 * composed for.
 *
 * The rule is to keep the subject at the relative position it already held. A
 * subject seven tenths of the way across a square stays seven tenths of the way
 * across the widescreen, which means more of the new canvas lands on its left.
 * Every original pixel still survives; only the offset changes.
 *
 * Asymmetric placement appears on the rejected list from 2026-08-25, but it was
 * rejected against a seam-invisibility metric, and where the picture sits in the
 * frame cannot affect how well its edges join. It is back for composition, and
 * it is judged on composition.
 */
import sharp from 'sharp';
import type { ExpandPlan } from '../expandRules.js';

/**
 * How far the subject may sit from centre, as a share of the new pixels.
 *
 * Clamped because the far side still has to give the engine something to
 * continue from: a picture pushed hard against one edge leaves a wide margin
 * with only a sliver of context feeding it.
 */
export const MIN_SHARE = 0.2;
export const MAX_SHARE = 0.8;

/**
 * Where the subject sits along an axis, as a fraction of the picture.
 *
 * Uses sharp's attention crop the way `smartCrop` already does: ask for a
 * window narrower than the picture and read back where it chose to put it. The
 * resized buffer is thrown away, only the offset matters.
 *
 * Averaged with the centre, which is the same softening `attentionCropOrigin`
 * applies, and for the same reason. Raw attention is confident about the wrong
 * thing often enough that halving its influence costs little and prevents the
 * one bad case: a subject shoved against an edge on a misread.
 */
export async function subjectFraction(
  src: Buffer,
  source: { width: number; height: number },
  axis: 'width' | 'height',
) {
  try {
    const window =
      axis === 'width'
        ? { width: Math.max(8, Math.round(source.width * 0.5)), height: source.height }
        : { width: source.width, height: Math.max(8, Math.round(source.height * 0.5)) };
    const { info } = await sharp(src)
      .resize(window.width, window.height, { fit: 'cover', position: 'attention' })
      .toBuffer({ resolveWithObject: true });
    const offset =
      axis === 'width'
        ? Math.abs(typeof info.cropOffsetLeft === 'number' ? info.cropOffsetLeft : 0)
        : Math.abs(typeof info.cropOffsetTop === 'number' ? info.cropOffsetTop : 0);
    const span = axis === 'width' ? source.width : source.height;
    const extent = axis === 'width' ? window.width : window.height;
    const centre = (offset + extent / 2) / span;
    return Math.min(1, Math.max(0, (centre + 0.5) / 2));
  } catch {
    // A picture that will not decode gets the old behaviour, not an error.
    return 0.5;
  }
}

/**
 * Move a plan so the subject keeps its relative position.
 *
 * Only the offset changes. The frame, the source size and every source pixel
 * are exactly as `planExpand` left them, so the preservation guarantee is
 * untouched and `compositeExpand` needs to know nothing about this.
 */
export function placeExpand(plan: ExpandPlan, source: { width: number; height: number }, fraction: number): ExpandPlan {
  const share = Math.min(MAX_SHARE, Math.max(MIN_SHARE, fraction));
  if (plan.axis === 'width') {
    const room = plan.width - source.width;
    if (room <= 0) return plan;
    return { ...plan, left: Math.min(room, Math.max(0, Math.round(room * share))) };
  }
  const room = plan.height - source.height;
  if (room <= 0) return plan;
  return { ...plan, top: Math.min(room, Math.max(0, Math.round(room * share))) };
}
