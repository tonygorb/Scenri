import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { planExpand } from '../../src/expandRules.js';
import { duplicationPeak, textureReport } from '../../src/outpaint/texture.js';

const SRC = { width: 256, height: 256 };
const plan = planExpand(SRC, 16 / 9)!;

/** Gaussian noise at a chosen texel size: bigger cell means coarser texture. */
const noise = async (w: number, h: number, cell: number, mean = 128) => {
  const small = await sharp({
    create: {
      width: Math.max(1, Math.round(w / cell)),
      height: Math.max(1, Math.round(h / cell)),
      channels: 3,
      background: { r: mean, g: mean, b: mean },
      noise: { type: 'gaussian' as const, mean, sigma: 40 },
    },
  })
    .png()
    .toBuffer();
  return sharp(small).resize(w, h, { fit: 'fill', kernel: 'nearest' }).png().toBuffer();
};

/** A finished frame: the picture in place, the margins filled from `margin`. */
const frame = async (picture: Buffer, margin: Buffer) =>
  sharp(margin)
    .composite([{ input: picture, left: plan.left, top: plan.top }])
    .png()
    .toBuffer();

describe('textureReport', () => {
  it('reads about 1 when the margin carries the picture at the same texel size', async () => {
    const picture = await noise(SRC.width, SRC.height, 4);
    const margin = await noise(plan.width, plan.height, 4);
    const { scale } = await textureReport(await frame(picture, margin), plan, SRC);
    expect(scale).toBeGreaterThan(0.75);
    expect(scale).toBeLessThan(1.35);
  });

  it('reads well below 1 when the margin is the same texture magnified', async () => {
    // This is what a cover-resized bed teaches: right colours, wrong texel size.
    const picture = await noise(SRC.width, SRC.height, 4);
    const margin = await noise(plan.width, plan.height, Math.round(4 * 1.78));
    const { scale } = await textureReport(await frame(picture, margin), plan, SRC);
    expect(scale).toBeLessThan(0.75);
  });

  it('separates a soft margin from a sharp picture', async () => {
    const picture = await noise(SRC.width, SRC.height, 4);
    const sharpMargin = await noise(plan.width, plan.height, 4);
    const softMargin = await sharp(sharpMargin).blur(6).png().toBuffer();
    const crisp = await textureReport(await frame(picture, sharpMargin), plan, SRC);
    const soft = await textureReport(await frame(picture, softMargin), plan, SRC);
    expect(soft.defocus).toBeLessThan(crisp.defocus);
  });

  it('survives a flat frame rather than dividing by nothing', async () => {
    const flat = (w: number, h: number) =>
      sharp({ create: { width: w, height: h, channels: 3, background: { r: 150, g: 150, b: 150 } } })
        .png()
        .toBuffer();
    const report = await textureReport(
      await frame(await flat(256, 256), await flat(plan.width, plan.height)),
      plan,
      SRC,
    );
    expect(report.scale).toBe(1);
    expect(Number.isFinite(report.defocus)).toBe(true);
  });
});

describe('duplicationPeak', () => {
  const subject = { left: 96, top: 96, width: 64, height: 64 };

  /**
   * A distinctive, patterned subject. Patterned deliberately: correlation needs
   * variance, so a featureless block cannot be detected as a duplicate of
   * anything, and neither could a real product that was one flat colour.
   */
  const blob = async (w = subject.width, h = subject.height) => {
    const bars = [];
    for (let y = 0; y < h; y += 8)
      bars.push({
        input: await sharp({ create: { width: w, height: 4, channels: 3, background: { r: 210, g: 190, b: 60 } } })
          .png()
          .toBuffer(),
        left: 0,
        top: y,
      });
    return sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 20, b: 30 } } })
      .composite(bars)
      .png()
      .toBuffer();
  };

  const withSubject = async () => {
    const bg = await noise(SRC.width, SRC.height, 6, 120);
    return sharp(bg)
      .composite([{ input: await blob(), left: subject.left, top: subject.top }])
      .png()
      .toBuffer();
  };

  it('is low when the margin is only background', async () => {
    const picture = await withSubject();
    const margin = await noise(plan.width, plan.height, 6, 120);
    const peak = await duplicationPeak(await frame(picture, margin), plan, SRC, subject);
    expect(peak).toBeLessThan(0.6);
  });

  it('is high when the subject has been drawn again out in the new space', async () => {
    // The failure a mirrored bed produced: a perfect join, and the product in the sky.
    const picture = await withSubject();
    const margin = await sharp(await noise(plan.width, plan.height, 6, 120))
      .composite([{ input: await blob(), left: 18, top: 120 }])
      .png()
      .toBuffer();
    const clean = await duplicationPeak(
      await frame(picture, await noise(plan.width, plan.height, 6, 120)),
      plan,
      SRC,
      subject,
    );
    const cloned = await duplicationPeak(await frame(picture, margin), plan, SRC, subject);
    expect(cloned).toBeGreaterThan(clean);
    expect(cloned).toBeGreaterThan(0.6);
  });
});
