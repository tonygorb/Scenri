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
import { seamBandFor, type ExpandPlan } from './expandRules.js';

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
 * GUARANTEE. In the expanded frame, every source pixel at distance >= N from a
 * seam edge is byte-identical to the original after decode, where
 * N = seamBandFor(source) = min(16, max(8, round(longEdge / 100))), never more
 * than a quarter of the source's short edge. Within the two N-px seam bands the
 * result is a deterministic linear blend of original over engine margin, and
 * the original's contribution never reaches zero inside the band. Source edges
 * that coincide with canvas edges have no seam and are byte-identical to the
 * last pixel. (A crop's guarantee is stronger and lives in cropRules.ts: every
 * output pixel is an original pixel.)
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

  const surround = aligned
    ? await sharp(engineImage).resize(plan.width, plan.height, { fit: 'cover', position: 'centre' }).toBuffer()
    : await expandCanvasBedOnly(source, plan);

  const image = await sharp(surround)
    .composite([{ input: await featheredSource(source, plan), left: plan.left, top: plan.top }])
    .png()
    .toBuffer();
  return { image, aligned };
}

/**
 * The source with a linear alpha ramp on its seam edges only.
 *
 * The geometry is exact — plan.left/top and the source's own dimensions — so
 * the mask is written analytically as one raw channel rather than derived by
 * blur-and-threshold the way localEdit must (its changed region has an unknown
 * silhouette; this one is a rectangle). Alpha 255 everywhere except the last
 * N columns (width axis) or rows (height axis) before each seam, ramping
 * 255*(d+1)/(N+1) so the outermost source pixel still contributes.
 */
async function featheredSource(source: Buffer, plan: ExpandPlan): Promise<Buffer> {
  const { data, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const n = seamBandFor({ width, height });
  const rampAt = (d: number) => (d < n ? Math.round((255 * (d + 1)) / (n + 1)) : 255);
  const mask = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = plan.axis === 'width' ? Math.min(x, width - 1 - x) : Math.min(y, height - 1 - y);
      mask[y * width + x] = rampAt(d);
    }
  }
  return sharp(data, { raw: { width, height, channels: channels as 3 } })
    .joinChannel(mask, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

/** The blurred bed on its own, for the case where the engine's frame is unusable. */
async function expandCanvasBedOnly(source: Buffer, plan: ExpandPlan): Promise<Buffer> {
  return sharp(source)
    .resize(plan.width, plan.height, { fit: 'cover', position: 'centre' })
    .blur(Math.max(8, Math.round(Math.max(plan.width, plan.height) / 40)))
    .toBuffer();
}
