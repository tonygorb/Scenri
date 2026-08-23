/**
 * Keeping the rest of the photograph when only one thing was asked to change.
 *
 * The engine is told to change one thing and leave the rest, and it mostly
 * does: a measured "add one subtle prop" moved 2.5 percent of the frame. But
 * mostly is not a guarantee, and the pixels it did not mean to touch still came
 * back re-rendered rather than untouched.
 *
 * So the change is measured, grown to carry the shadows and reflections that
 * belong to it, feathered, and pasted back over the original. Outside that
 * region the bytes are the source's own. This is the same technique Expand uses
 * and for the same reason: no provider we can reach promises to leave a region
 * alone, so the promise is kept here instead of asked for there.
 */
import sharp from 'sharp';
import { changeMask } from './diff.js';
import { dilationFor, judgeChange, type LocalEditOutcome } from './localEditRules.js';

export interface LocalEditResult {
  /** The picture to store: composited when that was safe, the engine's own otherwise. */
  image: Buffer;
  outcome: LocalEditOutcome;
  /** Fraction of the frame that moved, recorded whatever the outcome. */
  changed: number;
}

/**
 * Preserve everything the instruction did not name.
 *
 * Never throws: a failure in here means the edit is stored exactly as the
 * engine returned it, which is what would have happened anyway. Post-processing
 * is not allowed to cost somebody their picture.
 */
export async function preserveOutsideChange(source: Buffer, edited: Buffer): Promise<LocalEditResult> {
  try {
    const srcMeta = await sharp(source).metadata();
    const outMeta = await sharp(edited).metadata();
    if (!srcMeta.width || !srcMeta.height || !outMeta.width || !outMeta.height)
      return { image: edited, outcome: 'error', changed: 0 };

    // A different shape cannot be aligned pixel to pixel, and stretching one
    // onto the other would shear the very region being preserved.
    const sameShape =
      Math.abs(outMeta.width / outMeta.height - srcMeta.width / srcMeta.height) / (srcMeta.width / srcMeta.height) <=
      0.01;
    if (!sameShape) return { image: edited, outcome: 'shape-changed', changed: 0 };

    const shape = await changeMask(source, edited);
    const outcome = judgeChange(shape);
    if (outcome !== 'composited') return { image: edited, outcome, changed: shape.changed };

    // Grow, then soften. sharp has no morphology, so a blur followed by a hard
    // threshold is the dilation, and a second gentler blur is the feather that
    // keeps the seam from being a line.
    // The dilation has to outrun the feather by a wide margin. The changed
    // region's boundary IS the changed thing's silhouette, and the feather
    // blends original pixels with the engine's fill along that boundary; with
    // a tight dilation the blend band overlapped the object's own rim, so a
    // removed shoe came back as a translucent outline of itself, drawn by this
    // very compositor out of the pixels it was preserving. The full blur
    // radius before the threshold pushes the mask edge far past the rim, and
    // the feather then blends engine fill with original background only.
    // One materialized buffer per stage, deliberately. sharp is a settings
    // object, not a sequential chain: a second blur on the same instance
    // replaces the first rather than composing with it, and the pipeline
    // applies operations in its own fixed order. Written as one chain, the
    // dilation never happened, the mask interior sat half transparent over the
    // removed object, and the compositor drew a ghost outline of the very
    // thing it was removing out of the source it was preserving.
    const r = dilationFor(Math.max(shape.width, shape.height));
    const rawShape = { raw: { width: shape.width, height: shape.height, channels: 1 as const } };
    // Every stage collapses back to one channel before it is read: sharp
    // promotes even a raw single channel input to three on output, and the
    // next stage reading a third of a scrambled buffer is how the requested
    // change itself once vanished from the result.
    const spread = await sharp(shape.mask, rawShape).blur(r).toColourspace('b-w').raw().toBuffer();
    const dilated = await sharp(spread, rawShape).threshold(8).toColourspace('b-w').raw().toBuffer();
    const feathered = await sharp(dilated, rawShape)
      .blur(Math.max(2, r / 3))
      .toColourspace('b-w')
      .raw()
      .toBuffer();
    const grown = await sharp(feathered, rawShape)
      .resize(srcMeta.width, srcMeta.height, { fit: 'fill', kernel: 'cubic' })
      // resize can promote the channel count, and joinChannel below reads one
      // byte per pixel: collapse it back or the alpha is nonsense.
      .toColourspace('b-w')
      .raw()
      .toBuffer();

    // The engine's picture, wearing that mask as its alpha, laid over the
    // original. Outside the mask the result is the source byte for byte.
    const editedRgb = await sharp(edited)
      .resize(srcMeta.width, srcMeta.height, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();
    const masked = await sharp(editedRgb, {
      raw: { width: srcMeta.width, height: srcMeta.height, channels: 3 },
    })
      .joinChannel(grown, { raw: { width: srcMeta.width, height: srcMeta.height, channels: 1 } })
      .png()
      .toBuffer();

    const image = await sharp(source)
      .removeAlpha()
      .composite([{ input: masked }])
      .png()
      .toBuffer();
    return { image, outcome: 'composited', changed: shape.changed };
  } catch {
    return { image: edited, outcome: 'error', changed: 0 };
  }
}
