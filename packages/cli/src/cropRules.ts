/**
 * Where the frame lands when a picture is cut down to a new shape.
 *
 * The reduction half of reshaping a finished shot. Expansion (expandRules.ts)
 * grows the canvas and generates only the margin; a crop generates NOTHING.
 * It is pure geometry: the output is a rectangle of the original's own pixels,
 * decoded-byte identical to the region it names, with no engine, no cost and
 * no reinterpretation. Which of the two ops a reshape means is the caller's
 * decision — the user picks Crop or Extend in the composer, and the request
 * carries the choice explicitly.
 */

export interface CropPlan {
  /** The region of the source that survives, in source pixels. Exact. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Which axis was cut, for the record and the copy. */
  axis: 'width' | 'height';
}

/**
 * Plan a centred crop from a source's real pixels to a target aspect ratio.
 *
 * No rounding conventions apply: format tokens' multiple-of-8 rule governs
 * generated frames, and an extracted region is exact by definition. Returns
 * null when the ratios already agree within 1% (the same tolerance planExpand
 * uses) or the inputs are nonsense — never because the change is large; any
 * ratio is reachable by cutting one axis.
 */
export function planCrop(source: { width: number; height: number }, targetRatio: number): CropPlan | null {
  if (!(source.width > 0 && source.height > 0 && targetRatio > 0)) return null;
  const current = source.width / source.height;
  if (Math.abs(current - targetRatio) / targetRatio < 0.01) return null;
  if (targetRatio < current) {
    // narrower: keep every row, cut the sides evenly
    const width = Math.max(1, Math.min(source.width, Math.round(source.height * targetRatio)));
    return { left: Math.floor((source.width - width) / 2), top: 0, width, height: source.height, axis: 'width' };
  }
  // shorter: keep every column, cut top and bottom evenly
  const height = Math.max(1, Math.min(source.height, Math.round(source.width / targetRatio)));
  return { left: 0, top: Math.floor((source.height - height) / 2), width: source.width, height, axis: 'height' };
}

/**
 * The op the composer preselects when a target shape differs from the shot's.
 *
 * The user's mapping, not a ratio-sign rule: 1:1 to 16:9 extends the sides,
 * 1:1 to 9:16 extends above and below, 16:9 to 1:1 crops the sides. What
 * those share is that a MORE directional target reads as "give the picture a
 * wider stage" and a SQUARER one as "tighten onto what is there" — which is a
 * comparison of |log ratio|. The tie (as directional the other way, 16:9 to
 * 9:16) defaults to extend, the op that keeps every pixel. Only a default:
 * the request always carries the explicit choice.
 */
export function defaultReshapeOp(sourceRatio: number, targetRatio: number): 'extend' | 'crop' {
  if (!(sourceRatio > 0 && targetRatio > 0)) return 'extend';
  return Math.abs(Math.log(targetRatio)) < Math.abs(Math.log(sourceRatio)) - 0.01 ? 'crop' : 'extend';
}
