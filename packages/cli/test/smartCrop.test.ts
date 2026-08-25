import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { attentionCropOrigin } from '../src/smartCrop.js';
import { planCrop } from '../src/cropRules.js';

/**
 * A wide, flat grey field with one high-entropy block well off center — the
 * kind of frame a centred 16:9 → 1:1 crop would cut the subject out of.
 */
async function subjectLeftImage(): Promise<Buffer> {
  const noise = await sharp({
    create: {
      width: 200,
      height: 200,
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
      noise: { type: 'gaussian', mean: 128, sigma: 60 },
    },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .composite([{ input: noise, left: 30, top: 80 }])
    .png()
    .toBuffer();
}

describe('attention crop origin', () => {
  it('follows the subject instead of the center, and the extract is original pixels', async () => {
    const src = await subjectLeftImage();
    const plan = planCrop({ width: 640, height: 360 }, 1)!;
    expect(plan.axis).toBe('width');
    const origin = await attentionCropOrigin(src, { width: 640, height: 360 }, plan);

    // The salient block spans x 30..230; a centred window starts at 140. The
    // attention window must cover the block better than center does.
    expect(origin.left).toBeLessThan(plan.left);
    expect(origin.top).toBe(0);
    expect(origin.left).toBeGreaterThanOrEqual(0);
    expect(origin.left + plan.width).toBeLessThanOrEqual(640);

    // Byte identity by construction: the server extracts from the original at
    // this window; the same extract twice is the same bytes.
    const a = await sharp(src)
      .extract({ left: origin.left, top: origin.top, width: plan.width, height: plan.height })
      .raw()
      .toBuffer();
    const b = await sharp(src)
      .extract({ left: origin.left, top: origin.top, width: plan.width, height: plan.height })
      .raw()
      .toBuffer();
    expect(a.equals(b)).toBe(true);
    // and the window really contains subject pixels, not the flat field only
    const stats = await sharp(a, { raw: { width: plan.width, height: plan.height, channels: 3 } }).stats();
    expect(Math.max(...stats.channels.map((c) => c.stdev))).toBeGreaterThan(10);
  });

  it('locks the offset to the cut axis on a height crop', async () => {
    const src = await sharp({
      create: { width: 360, height: 640, channels: 3, background: { r: 180, g: 180, b: 180 } },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 180,
              height: 180,
              channels: 3,
              background: { r: 128, g: 128, b: 128 },
              noise: { type: 'gaussian', mean: 128, sigma: 60 },
            },
          })
            .png()
            .toBuffer(),
          left: 90,
          top: 420,
        },
      ])
      .png()
      .toBuffer();
    const plan = planCrop({ width: 360, height: 640 }, 1)!;
    expect(plan.axis).toBe('height');
    const origin = await attentionCropOrigin(src, { width: 360, height: 640 }, plan);
    expect(origin.left).toBe(0);
    expect(origin.top).toBeGreaterThan(plan.top);
    expect(origin.top + plan.height).toBeLessThanOrEqual(640);
  });

  it('falls back to the centred plan when the buffer is unreadable', async () => {
    const plan = planCrop({ width: 640, height: 360 }, 1)!;
    const origin = await attentionCropOrigin(Buffer.from('not an image'), { width: 640, height: 360 }, plan);
    expect(origin).toEqual({ left: plan.left, top: plan.top });
  });
});
