import sharp from 'sharp';
import type { CropPlan } from './cropRules.js';

/**
 * Where a crop window should sit, decided by the picture instead of its
 * center.
 *
 * A centred crop is deterministic but blind: 16:9 to 1:1 on a shot whose
 * subject stands left of center cuts the subject. sharp's `attention` strategy
 * (the same one presenter avatars use — customAssets.ts smartCover) picks the
 * most salient window, and because planCrop always keeps one axis full the
 * cover-resize runs at scale factor exactly 1 — so its reported crop offset is
 * already in source pixels.
 *
 * This function is offset discovery ONLY: the resized buffer sharp produces is
 * thrown away, and the caller extracts the window from the ORIGINAL bytes.
 * Byte identity is therefore true by construction, not by trusting a resize at
 * scale 1 never to resample.
 *
 * Deterministic per pinned sharp, no engine, no cost. Falls back to the
 * centred plan on any failure, the same best-effort contract smartCover keeps.
 */
export async function attentionCropOrigin(
  srcBuf: Buffer,
  source: { width: number; height: number },
  plan: CropPlan,
): Promise<{ left: number; top: number }> {
  try {
    const { info } = await sharp(srcBuf)
      .resize(plan.width, plan.height, { fit: 'cover', position: 'attention' })
      .toBuffer({ resolveWithObject: true });
    const left = typeof info.cropOffsetLeft === 'number' ? Math.abs(info.cropOffsetLeft) : plan.left;
    const top = typeof info.cropOffsetTop === 'number' ? Math.abs(info.cropOffsetTop) : plan.top;
    // Lock to the cut axis: the full axis never moves, and a stray offset
    // there would push the extract out of bounds.
    return plan.axis === 'width'
      ? { left: Math.min(Math.max(0, left), source.width - plan.width), top: 0 }
      : { left: 0, top: Math.min(Math.max(0, top), source.height - plan.height) };
  } catch {
    return { left: plan.left, top: plan.top };
  }
}
