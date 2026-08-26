/**
 * Where a picture sits when its frame grows around it.
 *
 * Changing the shape of a finished shot used to start a new one: a square you
 * liked, asked for as 16:9, came back as a different picture. Expanding it
 * instead keeps the photograph and generates only the margin, which is the one
 * edit whose region is known exactly rather than inferred, and therefore the
 * one where untouched pixels can be guaranteed rather than hoped for.
 *
 * The guarantee is what decides the geometry. The source is never scaled, only
 * surrounded: scaling it by even a fraction would resample every pixel and
 * there would be nothing left to preserve. So the new frame is the source's own
 * dimensions extended along one axis until the ratio is right, and the source
 * keeps its resolution wherever the picture ends up.
 */

/** Multiple of 8, because that is what the format tokens have always been. */
const round8 = (n: number) => Math.max(8, Math.round(n / 8) * 8);

export interface ExpandPlan {
  /** The frame to generate, in pixels. */
  width: number;
  height: number;
  /** Where the untouched source sits inside it. */
  left: number;
  top: number;
  /** Which way the frame grew, for the instruction and the record. */
  axis: 'width' | 'height';
}

/**
 * Plan an expansion from a source's real pixels to a target aspect ratio.
 *
 * Returns null only when there is nothing to do (the same ratio, or nonsense
 * input). Any other ratio is reached by GROWING one axis — never by cropping:
 * a squarer shape means a taller frame, not narrower pixels. When the user
 * wants the other op — cut down to the new shape instead of building out to
 * it — that is cropRules.ts, and the caller carries the choice explicitly.
 */
export function planExpand(source: { width: number; height: number }, targetRatio: number): ExpandPlan | null {
  if (!(source.width > 0 && source.height > 0 && targetRatio > 0)) return null;
  const current = source.width / source.height;
  // Same shape within a rounding hair: nothing to grow.
  if (Math.abs(current - targetRatio) / targetRatio < 0.01) return null;

  if (targetRatio > current) {
    // Wider frame: keep every row, add columns either side.
    const width = round8(source.height * targetRatio);
    if (width <= source.width) return null;
    return {
      width,
      height: source.height,
      left: Math.round((width - source.width) / 2),
      top: 0,
      axis: 'width',
    };
  }
  // Taller frame: keep every column, add rows above and below.
  const height = round8(source.width / targetRatio);
  if (height <= source.height) return null;
  return {
    width: source.width,
    height,
    left: 0,
    top: Math.round((height - source.height) / 2),
    axis: 'height',
  };
}

/**
 * What to ask the engine for, in words.
 *
 * It describes the margin rather than the picture, because the picture is
 * already there and the only thing being generated is what surrounds it. The
 * result is composited back over the original either way, so this text governs
 * what the new edges look like, never whether the middle survives.
 */
export function expandInstruction(plan: ExpandPlan, direction: string): string {
  const where = plan.axis === 'width' ? 'left and right' : 'top and bottom';
  /*
   * Written to the shape codex's own image skill asks for — short labelled
   * lines, one request, the invariants stated as "change only X, keep Y" —
   * rather than the paragraph this used to be. That paragraph stacked nine
   * simultaneous "match the ..." demands in one sentence, which is precisely
   * the form the skill tells you not to send.
   *
   * Two of those demands are gone on purpose. "Matching the existing grain"
   * named a texture, and naming a texture in a generative prompt amplifies it:
   * the margins measured 39% grainier than the photograph they continued.
   * Grain is recoverable in compositing, so failing clean is the better way to
   * fail. Lens and perspective vocabulary is gone too — this model family
   * carries bokeh and colour temperature across an edit but not focal length.
   *
   * The vertical case gets one extra line, phrased as a fact about where the
   * camera is rather than as a rate of change. Models of this family answer
   * camera-relative questions well (~95%) and quantitative "how much bigger"
   * questions badly (~30%), so "the bottom edge is the part nearest the
   * camera" is a far safer way to ask for a receding plane than "the texture
   * grows coarser toward the camera".
   */
  const nearEdge =
    plan.axis === 'height'
      ? '\nDepth: the bottom edge of the frame is the part of the surface nearest the camera; the top edge is the furthest away.'
      : '';
  /*
   * The compiler hands this the whole compiled prompt, and an inherited
   * identity directive arrives with a leading full stop already attached, so
   * the tail used to read "Also: . The extra attached references are ...".
   */
  const extra = direction.trim().replace(/^[.\s]+/, '');
  const own = extra ? `\nAlso: ${extra}` : '';
  return (
    `Fill only the soft blurred margin at the ${where} of this frame so the photograph continues into it.` +
    `\nContinue: the same surface, the same light direction, the same colour temperature and the same depth of field that are already in the picture.` +
    nearEdge +
    `\nConstraints: change only the blurred margin; keep the sharp photograph unchanged in position, scale and content.` +
    `\nAvoid: new objects, products, people, text or watermarks.` +
    own
  );
}
