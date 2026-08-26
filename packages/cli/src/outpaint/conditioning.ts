/**
 * The frame handed to an engine that cannot be given a mask.
 *
 * `expandCanvas` builds a bed for a compositing pass: the picture magnified to
 * fill the new frame, blurred, with the sharp original laid back on top. That
 * bed is right for a route whose middle is about to be covered anyway, and
 * wrong for a route whose answer is kept whole. Magnifying a square by 1.78x to
 * fill a 16:9 frame tells the model the margin's texture is 1.78x coarser than
 * the photograph's, and the model draws exactly that.
 *
 * A reframe gets the opposite: the source at its OWN scale, sitting where the
 * plan puts it, with the rest of the frame carrying no texture claim at all.
 * The geometry is then unambiguous — this is where the photograph belongs, this
 * much frame is new — and nothing in the input argues about how coarse the new
 * pixels should be.
 *
 * The result is conditioning only. Unlike the bed it is never composited into
 * an answer; the engine's own frame is what ships.
 */
import sharp, { type OverlayOptions, type Region } from 'sharp';
import type { ExpandPlan } from '../expandRules.js';

/**
 * What the new area carries before the model sees it.
 *
 * `grey` states nothing: a flat neutral field, no colour cast, no implied
 * content. `edge` continues the picture's own border pixels outward, which
 * carries the low-frequency truth — sky stays sky, the sweep keeps falling off
 * in the direction it was already falling — without inventing detail.
 * `transparent` states only "there is nothing here yet", and is the convention
 * OpenAI's own image documentation gives for expanding a canvas with this model
 * family: supply an image with transparent borders marking where it should
 * extend.
 *
 * Which one a model reads best is a measured question, not a guessed one, so
 * all three exist and the battery decides.
 */
export type MarginFill = 'grey' | 'edge' | 'transparent';

/** Neutral mid-grey: no cast to carry into the answer. */
const NEUTRAL = { r: 128, g: 128, b: 128 };

export async function conditioningCanvas(source: Buffer, plan: ExpandPlan, fill: MarginFill = 'edge'): Promise<Buffer> {
  const meta = await sharp(source).metadata();
  const sw = meta.width ?? 0;
  const sh = meta.height ?? 0;
  if (!(sw > 0 && sh > 0)) throw new Error('conditioningCanvas: source has no dimensions');

  const layers: OverlayOptions[] = [];
  if (fill === 'edge') layers.push(...(await edgeMargins(source, plan, { width: sw, height: sh })));
  // The source goes on last and at its native size: no resize call touches it,
  // so the model is looking at the photograph's real grain, not a resample of it.
  layers.push({ input: source, left: plan.left, top: plan.top });

  const canvas = sharp({
    create: {
      width: plan.width,
      height: plan.height,
      channels: 4,
      background: fill === 'transparent' ? { ...NEUTRAL, alpha: 0 } : { ...NEUTRAL, alpha: 1 },
    },
  }).composite(layers);
  // Compositing promotes to RGBA. Only the transparent fill has anything to say
  // with that channel; the other two keep three, so the file makes no claim
  // about transparency that the margin does not mean.
  return (fill === 'transparent' ? canvas : canvas.removeAlpha()).png().toBuffer();
}

/**
 * The picture's own border, stretched across each new region.
 *
 * One pixel of edge resized to the margin's full extent, which is replication
 * rather than interpolation: every column of a left margin is the source's
 * leftmost column. The frame only ever grows along one axis, so the two margins
 * span the other axis completely and there are no corners to reconcile.
 */
async function edgeMargins(
  source: Buffer,
  plan: ExpandPlan,
  size: { width: number; height: number },
): Promise<OverlayOptions[]> {
  const out: OverlayOptions[] = [];
  const strip = async (extract: Region, width: number, height: number) =>
    sharp(source).extract(extract).resize(width, height, { fit: 'fill' }).png().toBuffer();

  if (plan.axis === 'width') {
    const before = plan.left;
    const after = plan.width - plan.left - size.width;
    if (before > 0)
      out.push({
        input: await strip({ left: 0, top: 0, width: 1, height: size.height }, before, size.height),
        left: 0,
        top: plan.top,
      });
    if (after > 0)
      out.push({
        input: await strip({ left: size.width - 1, top: 0, width: 1, height: size.height }, after, size.height),
        left: plan.left + size.width,
        top: plan.top,
      });
    return out;
  }

  const above = plan.top;
  const below = plan.height - plan.top - size.height;
  if (above > 0)
    out.push({
      input: await strip({ left: 0, top: 0, width: size.width, height: 1 }, size.width, above),
      left: plan.left,
      top: 0,
    });
  if (below > 0)
    out.push({
      input: await strip({ left: 0, top: size.height - 1, width: size.width, height: 1 }, size.width, below),
      left: plan.left,
      top: plan.top + size.height,
    });
  return out;
}
