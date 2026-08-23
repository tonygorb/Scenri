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
 * laid over it byte for byte at the offset it was planned into.
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
    .composite([{ input: source, left: plan.left, top: plan.top }])
    .png()
    .toBuffer();
  return { image, aligned };
}

/** The blurred bed on its own, for the case where the engine's frame is unusable. */
async function expandCanvasBedOnly(source: Buffer, plan: ExpandPlan): Promise<Buffer> {
  return sharp(source)
    .resize(plan.width, plan.height, { fit: 'cover', position: 'centre' })
    .blur(Math.max(8, Math.round(Math.max(plan.width, plan.height) / 40)))
    .toBuffer();
}
