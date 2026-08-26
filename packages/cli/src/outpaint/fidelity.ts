/**
 * How much of the shot survived a frame the engine redrew whole.
 *
 * The compositing route needs no such measure: it puts the original back, so
 * the middle is the middle by construction and the only open question is the
 * join. A reframe has the opposite shape. There is no join to measure, because
 * there is no paste — and there is no guarantee either, because the model
 * regenerated every pixel. What can be asked instead is whether the region the
 * photograph occupied still holds the same photograph.
 *
 * So this compares the answer's central region against the source it came from,
 * and it deliberately does NOT ask for pixel identity. A reframe that shifts
 * every value by a level or two while keeping the bottle, its label, its scale
 * and its light is a success; one that scores well on averages while quietly
 * redrawing the product is not. That is why four separate signals are reported
 * rather than one distance:
 *
 *   luma      structure — did anything move, resize, or get replaced
 *   edges     geometry  — did the contours stay where they were
 *   colour    tone      — did the grade drift
 *   contrast  rendering — did the depth of field or the light change
 *
 * NO THRESHOLD LIVES HERE. What counts as too much drift is a measured
 * question, and the answer comes from the battery, not from a number invented
 * next to the code that would use it.
 */
import sharp from 'sharp';
import type { ExpandPlan } from '../expandRules.js';

/** Comparison resolution. Big enough to carry contours, small enough to be free. */
const SAMPLE = 256;

/** How far the channel means may drift before `colour` reaches zero. */
const COLOUR_FULL_SCALE = 64;
/** How far the channel deviations may drift before `contrast` reaches zero. */
const CONTRAST_FULL_SCALE = 32;

export interface FidelityScore {
  /** Weighted summary, 0 (unrecognisable) to 1 (indistinguishable). */
  overall: number;
  /** Structural agreement of the luma channel. */
  luma: number;
  /** Agreement of the gradient map: contours in the same places. */
  edges: number;
  /** Agreement of the per-channel means: the grade. */
  colour: number;
  /** Agreement of the per-channel deviations: rendering and depth of field. */
  contrast: number;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/**
 * Lift the answer's central region out at the planned geometry.
 *
 * The engine may answer at its own size, so the frame is fitted to the plan
 * first — the same `cover` fit the compositing route uses, so both routes read
 * the same geometry — and the region is then taken at exactly the coordinates
 * the source was planned into.
 */
export async function centralRegion(result: Buffer, plan: ExpandPlan, source: { width: number; height: number }) {
  const meta = await sharp(result).metadata();
  const exact = meta.width === plan.width && meta.height === plan.height;
  const framed = exact
    ? result
    : await sharp(result).resize(plan.width, plan.height, { fit: 'cover', position: 'centre' }).toBuffer();
  // A plan can only place the source inside the frame it grew, so the window is
  // always in bounds; clamping anyway keeps a malformed plan from throwing deep
  // inside sharp with an unreadable message.
  const width = Math.min(source.width, plan.width - plan.left);
  const height = Math.min(source.height, plan.height - plan.top);
  return sharp(framed).extract({ left: plan.left, top: plan.top, width, height }).png().toBuffer();
}

export async function centralFidelity(result: Buffer, source: Buffer, plan: ExpandPlan): Promise<FidelityScore> {
  const meta = await sharp(source).metadata();
  const size = { width: meta.width ?? 0, height: meta.height ?? 0 };
  if (!(size.width > 0 && size.height > 0)) throw new Error('centralFidelity: source has no dimensions');

  const region = await centralRegion(result, plan, size);
  // `fill` on both sides, so the two arrays index the same place in the picture
  // even when the engine's answer had a slightly different shape.
  const [a, b] = await Promise.all([sample(region), sample(source)]);

  const lumaA = luma(a);
  const lumaB = luma(b);
  const lumaScore = clamp01(correlate(lumaA, lumaB));
  const edgeScore = clamp01(correlate(gradient(lumaA), gradient(lumaB)));

  const statsA = channelStats(a);
  const statsB = channelStats(b);
  const meanDrift = mean(statsA.means.map((m, i) => Math.abs(m - statsB.means[i])));
  const devDrift = mean(statsA.devs.map((d, i) => Math.abs(d - statsB.devs[i])));
  const colour = clamp01(1 - meanDrift / COLOUR_FULL_SCALE);
  const contrast = clamp01(1 - devDrift / CONTRAST_FULL_SCALE);

  return {
    overall: clamp01(0.4 * lumaScore + 0.3 * edgeScore + 0.2 * colour + 0.1 * contrast),
    luma: lumaScore,
    edges: edgeScore,
    colour,
    contrast,
  };
}

/** Both pictures at the same grid, three channels, no alpha to skew a mean. */
async function sample(buf: Buffer): Promise<Uint8Array> {
  const { data } = await sharp(buf)
    .removeAlpha()
    .resize(SAMPLE, SAMPLE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data.buffer, data.byteOffset, data.length);
}

function luma(rgb: Uint8Array): Float64Array {
  const out = new Float64Array(SAMPLE * SAMPLE);
  for (let i = 0, p = 0; p < out.length; p++, i += 3) {
    out[p] = 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2];
  }
  return out;
}

/**
 * Gradient magnitude, forward difference.
 *
 * Contours rather than content: two renderings of the same scene disagree about
 * values everywhere and agree about where the edges are, so this is the signal
 * that notices a product that moved or changed size when the grade did not.
 */
function gradient(src: Float64Array): Float64Array {
  const out = new Float64Array(src.length);
  for (let y = 0; y < SAMPLE - 1; y++) {
    for (let x = 0; x < SAMPLE - 1; x++) {
      const i = y * SAMPLE + x;
      out[i] = Math.abs(src[i + 1] - src[i]) + Math.abs(src[i + SAMPLE] - src[i]);
    }
  }
  return out;
}

function channelStats(rgb: Uint8Array) {
  const means: number[] = [];
  const devs: number[] = [];
  const count = SAMPLE * SAMPLE;
  for (let c = 0; c < 3; c++) {
    let sum = 0;
    for (let i = c; i < rgb.length; i += 3) sum += rgb[i];
    const m = sum / count;
    let sq = 0;
    for (let i = c; i < rgb.length; i += 3) sq += (rgb[i] - m) ** 2;
    means.push(m);
    devs.push(Math.sqrt(sq / count));
  }
  return { means, devs };
}

/** Pearson correlation; 0 when either side is perfectly flat and has none. */
function correlate(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  // A flat picture correlates with nothing. Two flat pictures are however
  // genuinely identical in structure, which is agreement, not absence of it.
  if (da === 0 || db === 0) return da === db ? 1 : 0;
  return num / Math.sqrt(da * db);
}

const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / Math.max(1, xs.length);
