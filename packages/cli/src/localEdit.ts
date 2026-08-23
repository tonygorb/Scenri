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
    const r = dilationFor(Math.max(shape.width, shape.height));
    const grown = await sharp(shape.mask, { raw: { width: shape.width, height: shape.height, channels: 1 } })
      .blur(Math.max(1, r / 3))
      .threshold(1)
      .blur(Math.max(2, r / 3))
      .resize(srcMeta.width, srcMeta.height, { fit: 'fill', kernel: 'cubic' })
      // threshold promotes a single channel to three, and joinChannel below
      // reads this as one byte per pixel: without collapsing it back the mask
      // is three times too long and the alpha it produces is nonsense.
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
