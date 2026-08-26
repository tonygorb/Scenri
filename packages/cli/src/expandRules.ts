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

/**
 * Common shapes, so the frame can be named rather than described in pixels.
 *
 * A model composes for "16:9" far more readily than for "1824 by 1024", and the
 * Codex path cannot request a size at all — its image tool pins `size` to
 * `auto` and the agent resizes the artifact afterwards. So the SHAPE has to
 * arrive as language, or the frame is composed square and squeezed later.
 */
const NAMED_RATIOS: Array<[string, number]> = [
  ['1:1', 1],
  ['4:5', 4 / 5],
  ['5:4', 5 / 4],
  ['2:3', 2 / 3],
  ['3:2', 3 / 2],
  ['3:4', 3 / 4],
  ['4:3', 4 / 3],
  ['9:16', 9 / 16],
  ['16:9', 16 / 9],
  ['2:1', 2],
  ['1:2', 0.5],
];

export function ratioLabel(width: number, height: number): string {
  const ratio = width / height;
  for (const [label, value] of NAMED_RATIOS) {
    if (Math.abs(ratio - value) / value < 0.02) return label;
  }
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const d = gcd(width, height) || 1;
  return `${Math.round(width / d)}:${Math.round(height / d)}`;
}

/**
 * What to ask an engine that will redraw the whole frame.
 *
 * `expandInstruction` describes a margin, because the route it serves keeps the
 * photograph and generates only what surrounds it. An engine with no mask
 * cannot do that — Codex's image tool takes a prompt and up to five pictures and
 * regenerates every pixel — so asking it to "change only the blurred margin"
 * asks for something it has no way to honour, and the answer's middle then gets
 * thrown away and replaced, which is what makes the result look joined.
 *
 * This asks for the thing it can actually do: the same photograph, composed at
 * a wider frame. Three things carry that, in the order the model reads them.
 * The SHAPE, named rather than measured, because `size` is unreachable on this
 * path and a frame composed square cannot be un-squeezed afterwards. The
 * GEOMETRY, as where the supplied picture sits in the result, because "make it
 * 16:9" invites a recomposition and "this is the middle of it" does not. And
 * the INVARIANTS, stated as things that stay rather than things to avoid
 * changing.
 *
 * Two lessons from the compositing route carry over unchanged. Grain is never
 * named: naming a texture amplifies it, measured at 39% grainier margins. Lens
 * and focal-length vocabulary is never used: this model family carries bokeh and
 * colour temperature across an edit and does not carry focal length. And one
 * word is banned outright — "zoom out", which is how a model is told to make
 * the subject smaller, and the subject must not change size at all.
 */
export function reframeInstruction(
  plan: ExpandPlan,
  source: { width: number; height: number },
  direction: string,
): string {
  const wider = plan.axis === 'width';
  const where = wider ? 'to the left and to the right' : 'above and below';
  const shape = ratioLabel(plan.width, plan.height);
  // What share of the new frame the photograph still occupies, along the axis
  // that grew. Stated as a share rather than as a growth factor: a model asked
  // "how much bigger" answers badly, and asked "where does this sit" answers well.
  const share = wider ? source.width / plan.width : source.height / plan.height;
  const middle = `${Math.round(share * 100)}%`;
  const span = wider ? 'width' : 'height';
  /*
   * The vertical case keeps the one extra line the compositing route earned:
   * a fact about where the camera is, not a rate of change, because a receding
   * surface is the thing a taller frame most often gets wrong.
   */
  const nearEdge = wider
    ? ''
    : '\nDepth: the bottom edge of the frame is the part of the surface nearest the camera; the top edge is the furthest away.';
  const extra = direction.trim().replace(/^[.\s]+/, '');
  const own = extra ? `\nAlso: ${extra}` : '';
  return (
    `Redraw this photograph as one ${shape} frame, ${wider ? 'wider' : 'taller'} than it is now, revealing more of the same scene ${where}.` +
    `\nFrame: the photograph you were given is the middle ${middle} of the new frame's ${span}; everything outside that is scene that was just beyond the original edges.` +
    `\nKeep: every object in the same place at the same size, the same camera position and height, the same light direction and colour temperature, the same depth of field, the same colours, and the same clothing.` +
    nearEdge +
    `\nAvoid: new objects, products, people, text or watermarks; do not recompose, recentre, crop or resize anything already visible.` +
    own
  );
}

/**
 * What to ask when the frame is padded and the picture must survive.
 *
 * This is the third thing that can be said to an engine, and the bake-off put
 * it there. `expandInstruction` describes a blurred bed, `reframeInstruction`
 * asks for the photograph composed wider — and the first real runs suggested
 * the two differ less in what they show the model than in what they ask of it.
 * The bed arm, told "keep the sharp photograph unchanged", came back with the
 * middle intact; the padded arm, told "redraw this photograph", redrew it and
 * lost the subject's scale. Same model, same picture, opposite verbs.
 *
 * So this pairs the conditioning that does not lie about texture scale with the
 * verb that does not invite a recomposition: the empty area is the only thing
 * being asked for, and the photograph is a thing that already exists. Whether
 * that combination actually beats either parent is measured, not assumed.
 *
 * The same two vocabulary bans apply as everywhere else on this path: grain is
 * never named, and no lens or focal length is mentioned.
 */
export interface ContinueOptions {
  /**
   * State the axis that did not grow as a fact about the frame's edges.
   *
   * `planExpand` never scales the source: a wider frame keeps every row and
   * adds columns, so the photograph's top and bottom edges ARE the new frame's
   * top and bottom edges. That is exact, checkable geometry, and it is the one
   * thing that contradicts the failure every reframe arm shares — the model
   * widening its field of view and shrinking the subject to suit the new shape.
   * Saying "the same size" is an instruction to be obeyed; saying "these edges
   * are those edges" is a fact about the picture, and this model family follows
   * facts about the frame far better than it follows requests about scale.
   */
  anchorUnchangedAxis?: boolean;
}

export function continueInstruction(plan: ExpandPlan, direction: string, opts: ContinueOptions = {}): string {
  const where = plan.axis === 'width' ? 'left and right' : 'top and bottom';
  const kept = plan.axis === 'width' ? 'top and bottom' : 'left and right';
  const anchor = opts.anchorUnchangedAxis
    ? `\nGeometry: the photograph's ${kept} edges are already the ${kept} edges of the finished frame, so nothing in it moves and nothing in it becomes smaller; the frame gains ${plan.axis === 'width' ? 'width' : 'height'} only.`
    : '';
  const nearEdge =
    plan.axis === 'height'
      ? '\nDepth: the bottom edge of the frame is the part of the surface nearest the camera; the top edge is the furthest away.'
      : '';
  const extra = direction.trim().replace(/^[.\s]+/, '');
  const own = extra ? `\nAlso: ${extra}` : '';
  return (
    `Fill the empty area at the ${where} of this frame so the photograph continues into it.` +
    anchor +
    `\nContinue: the same surface, the same light direction, the same colour temperature and the same depth of field that are already in the picture.` +
    nearEdge +
    `\nConstraints: change only the empty area; keep the photograph itself unchanged in position, scale and content.` +
    `\nAvoid: new objects, products, people, text or watermarks.` +
    own
  );
}
