/**
 * Growing a shot's frame without touching the shot.
 *
 * Two sharp passes around one engine call. First the source is laid onto the
 * bigger frame so the model can see what it is continuing, with the margin
 * filled by a blurred stretch of the picture's own edges rather than flat grey,
 * because an engine handed a hard grey border tends to render the border.
 * Then, whatever comes back, the original is composited over it at the same
 * offset.
 *
 * That second pass is the whole point. No provider we can reach guarantees an
 * untouched region: the GPT image family documents even a masked edit as a soft
 * mask over a total re-render. So the guarantee is not requested, it is taken,
 * and it holds on any engine including one that only accepts a picture and a
 * sentence.
 */
import sharp from 'sharp';
import type { ExpandPlan } from './expandRules.js';
import { solveMembrane } from './outpaint/membrane.js';

/**
 * The canvas handed to the engine: the real picture in place, and a margin made
 * of its own blurred edges to continue from.
 */
export async function expandCanvas(source: Buffer, plan: ExpandPlan): Promise<Buffer> {
  const bed = await sharp(source)
    .resize(plan.width, plan.height, { fit: 'cover', position: 'centre' })
    .blur(Math.max(8, Math.round(Math.max(plan.width, plan.height) / 40)))
    .toBuffer();
  return sharp(bed)
    .composite([{ input: source, left: plan.left, top: plan.top }])
    .png()
    .toBuffer();
}

export interface ExpandResult {
  image: Buffer;
  /** False when the engine's frame could not be aligned and the bed was kept. */
  aligned: boolean;
}

/**
 * Put the original back.
 *
 * The engine's answer supplies the margin and nothing else. It is fitted to the
 * planned frame first, because a model asked for 1824x1024 may well return
 * something a few pixels out or a whole multiple larger, and then the source is
 * laid over it at the offset it was planned into — carrying a narrow alpha ramp
 * on its seam edges so the paste has no visible line.
 *
 * GUARANTEE. Every pixel of the original survives into the expanded frame
 * byte for byte, with no band and no exception: the picture is composited
 * whole, over content whose values were first reconciled to it at the join.
 * There used to be a feathered band here, because the margin and the picture
 * met at different values and the ramp was the only thing hiding the step.
 * Reconciling the margin removes the step at its source, which makes the ramp
 * unnecessary — and a ramp is worse than unnecessary, because every pixel it
 * softens is a pixel of the original diluted with something the engine drew.
 */
export async function compositeExpand(engineImage: Buffer, source: Buffer, plan: ExpandPlan): Promise<ExpandResult> {
  const meta = await sharp(engineImage).metadata();
  const want = plan.width / plan.height;
  const got = meta.width && meta.height ? meta.width / meta.height : 0;
  /*
   * The engine's answer only has to supply plausible surroundings, because the
   * middle of it is about to be covered by the original anyway. So it is fitted
   * with `cover` rather than matched exactly: an engine that renders at its own
   * native sizes, which is what codex does, answers a 1824x1024 request with
   * something like 1536x1024, and demanding the exact frame threw that away and
   * left a blurred bed where a real continuation should have been.
   *
   * `cover` scales and crops rather than shearing, so the margin keeps its
   * proportions. What still cannot be used is an answer in the opposite
   * orientation: cropping a tall frame down to a wide one leaves a sliver with
   * nothing of the scene in it.
   */
  const sameOrientation = got > 0 && got >= 1 === want >= 1;
  const aligned = sameOrientation;

  // An answer already at the planned size skips the rescale entirely — the
  // whole point of asking the engine for exact dimensions: cover-scaling the
  // answer shifts its texture against the pasted original at the seam.
  const exact = meta.width === plan.width && meta.height === plan.height;
  const surround = aligned
    ? exact
      ? engineImage
      : await sharp(engineImage).resize(plan.width, plan.height, { fit: 'cover', position: 'centre' }).toBuffer()
    : await expandCanvasBedOnly(source, plan);

  // The alpha ramp hides a texture mismatch but cannot hide a value one: two
  // renderings of the same scene disagree along the join, and a disagreement
  // that runs the length of a straight line is exactly what the eye finds.
  // Reconcile each margin to the picture's own edge first, per pixel along the
  // seam, so the ramp has only texture left to blend.
  const matched = aligned ? await matchMarginsToSeam(surround, source, plan) : surround;

  const image = await sharp(matched)
    .composite([{ input: source, left: plan.left, top: plan.top }])
    .png()
    .toBuffer();
  return { image, aligned };
}

/**
 * Make each generated margin meet the original exactly at the seam.
 *
 * The margin and the picture are two different renderings of the same scene,
 * so where they meet their values disagree — and a disagreement along a
 * straight line is the one thing the eye is superb at spotting. Matching the
 * margin's mean tone (what this used to do) fixes the average and leaves the
 * variation: a seam whose error runs +6 at the top and -4 at the bottom still
 * draws a line, because one number cannot describe it.
 *
 * So the error is measured per pixel ALONG the seam, and then carried into the
 * margin as a correction that decays to nothing at the outer edge — the
 * membrane solution to Laplace's equation on a strip, which is the
 * gradient-domain result (Perez et al., "Poisson Image Editing", 2003): the
 * value discontinuity at the boundary becomes zero by construction while the
 * margin keeps its own texture and detail everywhere else.
 *
 * The error is smoothed along the seam first, so the correction is a slow
 * field rather than a copy of the boundary's noise, and clamped, so a margin
 * that legitimately differs (sky above a ground-level shot) is reconciled
 * rather than repainted.
 *
 * Not one pixel of the original is read into the output here — this only ever
 * writes inside the margins, which is why it costs the preservation guarantee
 * nothing at all.
 */
async function matchMarginsToSeam(surround: Buffer, source: Buffer, plan: ExpandPlan): Promise<Buffer> {
  const src = await sharp(source).metadata();
  if (!src.width || !src.height) return surround;
  const SW = src.width;
  const SH = src.height;

  interface Side {
    /** the margin to correct, in surround coordinates */
    margin: { left: number; top: number; width: number; height: number };
    /** the original's edge line, in source coordinates */
    srcEdge: { left: number; top: number; width: number; height: number };
    /** which end of the margin touches the picture */
    seamAt: 'far' | 'near';
  }
  const sides: Side[] = [];
  if (plan.axis === 'width') {
    if (plan.left > 0)
      sides.push({
        margin: { left: 0, top: plan.top, width: plan.left, height: SH },
        srcEdge: { left: 0, top: 0, width: 1, height: SH },
        seamAt: 'far',
      });
    const rightAt = plan.left + SW;
    if (rightAt < plan.width)
      sides.push({
        margin: { left: rightAt, top: plan.top, width: plan.width - rightAt, height: SH },
        srcEdge: { left: SW - 1, top: 0, width: 1, height: SH },
        seamAt: 'near',
      });
  } else {
    if (plan.top > 0)
      sides.push({
        margin: { left: plan.left, top: 0, width: SW, height: plan.top },
        srcEdge: { left: 0, top: 0, width: SW, height: 1 },
        seamAt: 'far',
      });
    const bottomAt = plan.top + SH;
    if (bottomAt < plan.height)
      sides.push({
        margin: { left: plan.left, top: bottomAt, width: SW, height: plan.height - bottomAt },
        srcEdge: { left: 0, top: SH - 1, width: SW, height: 1 },
        seamAt: 'near',
      });
  }

  let out = surround;
  for (const side of sides) {
    try {
      out = await reconcile(out, source, side, plan.axis);
    } catch {
      // best effort: an unreadable strip leaves that margin as the engine drew it
    }
  }
  return out;
}

/** How far a boundary error is allowed to move a pixel. */
const MAX_CORRECTION = 60;

async function reconcile(
  surround: Buffer,
  source: Buffer,
  side: {
    margin: { left: number; top: number; width: number; height: number };
    srcEdge: { left: number; top: number; width: number; height: number };
    seamAt: 'far' | 'near';
  },
  axis: 'width' | 'height',
): Promise<Buffer> {
  const { margin } = side;
  if (margin.width < 1 || margin.height < 1) return surround;

  const marginRaw = await sharp(surround).extract(margin).removeAlpha().raw().toBuffer();
  const edgeRaw = await sharp(source).extract(side.srcEdge).removeAlpha().raw().toBuffer();

  const W = margin.width;
  const H = margin.height;
  // Along the seam: rows for a vertical seam, columns for a horizontal one.
  const along = axis === 'width' ? H : W;
  // The margin's own line of pixels that touches the picture.
  const seamIndex = side.seamAt === 'far' ? (axis === 'width' ? W - 1 : H - 1) : 0;

  // The error the seam has to absorb, per pixel along it, per channel.
  const err = new Float32Array(along * 3);
  for (let i = 0; i < along; i++) {
    const mOff = axis === 'width' ? (i * W + seamIndex) * 3 : (seamIndex * W + i) * 3;
    for (let c = 0; c < 3; c++) {
      const want = edgeRaw[i * 3 + c];
      const have = marginRaw[mOff + c];
      err[i * 3 + c] = Math.max(-MAX_CORRECTION, Math.min(MAX_CORRECTION, want - have));
    }
  }

  // Smooth it along the seam so the correction is a field, not the boundary's
  // own grain repeated into the margin.
  const radius = Math.max(2, Math.round(along / 64));
  const smooth = new Float32Array(err.length);
  for (let i = 0; i < along; i++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      let n = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = i + k;
        if (j < 0 || j >= along) continue;
        sum += err[j * 3 + c];
        n++;
      }
      smooth[i * 3 + c] = sum / n;
    }
  }

  // Split off the part of the boundary data whose continuation is already
  // known, and carry that across the whole margin rather than letting it decay.
  //
  // A plane - a constant plus a slope along the seam - satisfies Laplace
  // exactly, so it is a legitimate correction at any depth. The solver would
  // still bleed it away, because the zero-gradient condition at the ends of the
  // strip is a boundary the picture does not actually have. A bulk tone
  // difference and a lighting falloff along the join are both planes, and both
  // are properties of the whole margin, not of its edge.
  //
  // Fitted through the medians of the two halves rather than by least squares,
  // so a dark object standing against part of the frame edge tilts nothing.
  const half = Math.max(1, Math.floor(along / 2));
  const centreLo = (half - 1) / 2;
  const centreHi = half + (along - half - 1) / 2;
  const span = Math.max(1, centreHi - centreLo);
  const base = [0, 0, 0];
  const slope = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const lo = medianOf(smooth, c, 0, half);
    const hi = medianOf(smooth, c, half, along);
    slope[c] = (hi - lo) / span;
    base[c] = lo - slope[c] * centreLo;
    for (let i = 0; i < along; i++) smooth[i * 3 + c] -= base[c] + slope[c] * i;
  }

  // Carry the rest in as a harmonic field rather than as a ramp. The ramp was
  // separable - one profile along the seam, scaled down with depth - so an
  // error that stepped halfway along the join stayed a step all the way to the
  // outer edge. A solved membrane diffuses sideways as it travels inward, which
  // is what makes the correction disappear instead of becoming a band.
  const field = solveMembrane({ width: W, height: H, axis, seamAt: side.seamAt, seam: smooth });

  const corrected = Buffer.from(marginRaw);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = axis === 'width' ? y : x;
      const off = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) {
        const v = corrected[off + c] + base[c] + slope[c] * i + field[off + c];
        corrected[off + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      }
    }
  }

  const patch = await sharp(corrected, { raw: { width: W, height: H, channels: 3 } })
    .png()
    .toBuffer();
  return sharp(surround)
    .composite([{ input: patch, left: margin.left, top: margin.top }])
    .toBuffer();
}

/** The blurred bed on its own, for the case where the engine's frame is unusable. */
async function expandCanvasBedOnly(source: Buffer, plan: ExpandPlan): Promise<Buffer> {
  return sharp(source)
    .resize(plan.width, plan.height, { fit: 'cover', position: 'centre' })
    .blur(Math.max(8, Math.round(Math.max(plan.width, plan.height) / 40)))
    .toBuffer();
}

/** Median of one channel of a run of RGB triples, over [from, to). */
function medianOf(rgb: Float32Array, channel: number, from: number, to: number): number {
  const n = to - from;
  if (n < 1) return 0;
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) values[i] = rgb[(from + i) * 3 + channel];
  values.sort();
  return n % 2 ? values[(n - 1) / 2] : (values[n / 2 - 1] + values[n / 2]) / 2;
}

/**
 * Keep the engine's own frame, and only make it the planned size.
 *
 * The other assembly in this file puts the original back, which is right for a
 * provider that painted a margin around it. An engine with no mask did not do
 * that: it redrew the whole frame, and its answer is internally consistent in a
 * way a composite cannot be — the light, the surface and the depth of field
 * agree across the whole picture because they were drawn at once.
 *
 * So nothing is pasted and nothing is reconciled. The frame is only ever
 * resized to the pixels that were planned, and only when the engine did not
 * already deliver them: `fill` when the shape it chose already matches, because
 * that resamples without cropping, and `cover` when it does not, because
 * shearing a photograph is worse than losing a little of its edge.
 *
 * Returns null when the answer cannot be used at all — an answer in the
 * opposite orientation has nothing of the frame in it, and the caller has a
 * better candidate to fall back to.
 */
export async function reframeExpand(engineImage: Buffer, plan: ExpandPlan): Promise<Buffer | null> {
  const meta = await sharp(engineImage).metadata();
  if (!(meta.width && meta.height)) return null;
  const want = plan.width / plan.height;
  const got = meta.width / meta.height;
  if (got >= 1 !== want >= 1) return null;
  if (meta.width === plan.width && meta.height === plan.height) return engineImage;
  const straight = Math.abs(got - want) / want <= 0.02;
  return sharp(engineImage)
    .resize(plan.width, plan.height, { fit: straight ? 'fill' : 'cover', position: 'centre' })
    .png()
    .toBuffer();
}
