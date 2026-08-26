import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { compositeExpand } from '../../src/expand.js';
import { planExpand } from '../../src/expandRules.js';

const solid = (w: number, h: number, v: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: v, g: v, b: v } } })
    .png()
    .toBuffer();

/** A picture whose top and bottom halves differ, so the seam error varies along the join. */
const halves = async (w: number, h: number, top: number, bottom: number) =>
  sharp(await solid(w, h, top))
    .composite([{ input: await solid(w, Math.floor(h / 2), bottom), left: 0, top: Math.floor(h / 2) }])
    .png()
    .toBuffer();

/** Horizontal bands, so the seam error varies along the join at a known period. */
const bands = async (w: number, h: number, period: number, dark: number, light: number) => {
  const stripes = [];
  for (let y = Math.floor(period / 2); y < h; y += period)
    stripes.push({ input: await solid(w, Math.min(Math.floor(period / 2), h - y), light), left: 0, top: y });
  return sharp(await solid(w, h, dark))
    .composite(stripes)
    .png()
    .toBuffer();
};

/** Grey level of the expanded frame at a pixel. */
const read = async (buf: Buffer, x: number, y: number) =>
  (await sharp(buf).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer())[0];

describe('reconciling a margin to the picture it continues', () => {
  it('carries a flat difference all the way to the frame edge', async () => {
    // The "the sky came back slightly bluer" case. The ramp could not fix it:
    // its correction decayed to nothing at the outer edge by construction, so
    // the far end of the margin kept whatever tone the engine drew.
    const src = await solid(256, 256, 150);
    const plan = planExpand({ width: 256, height: 256 }, 16 / 9)!;
    const answer = await solid(plan.width, plan.height, 110);

    const { image, aligned } = await compositeExpand(answer, src, plan);
    expect(aligned).toBe(true);

    const mid = Math.floor(plan.height / 2);
    // At the join, and just as importantly at the outer edge of the margin.
    expect(await read(image, plan.left - 1, mid)).toBeGreaterThan(145);
    expect(await read(image, 0, mid)).toBeGreaterThan(145);
    expect(await read(image, plan.width - 1, mid)).toBeGreaterThan(145);
  });

  it('lets a varying seam error fade with depth instead of stamping it through the margin', async () => {
    // The defect the ramp had. Its field was one along-seam profile multiplied
    // by a depth ramp, so whatever shape the error had at the join was still
    // there at the far edge of the margin, merely fainter. That is a ghost of
    // the seam printed across the new pixels. A harmonic field diffuses
    // sideways as it travels, so detail along the join dies within a few tens
    // of pixels and only the broadest variation reaches the frame edge.
    const src = await bands(256, 256, 32, 130, 170);
    const plan = planExpand({ width: 256, height: 256 }, 16 / 9)!;
    const answer = await solid(plan.width, plan.height, 150);

    const { image } = await compositeExpand(answer, src, plan);

    // One dark band centre against the neighbouring light band centre.
    const ripple = async (x: number) => Math.abs((await read(image, x, 8)) - (await read(image, x, 24)));

    // The join carries the banding, which is the correction doing its job.
    const atJoin = await ripple(plan.left - 1);
    expect(atJoin).toBeGreaterThan(25);
    // A fifth of the way in it is already gone. The ramp would still have had
    // roughly four fifths of it here, and a fifth of it at the frame edge.
    expect(await ripple(plan.left - 1 - Math.round(plan.left * 0.2))).toBeLessThan(atJoin * 0.15);
    expect(await ripple(0)).toBeLessThan(atJoin * 0.05);
  });

  it('still returns the picture byte for byte while doing it', async () => {
    const src = await halves(256, 256, 120, 180);
    const plan = planExpand({ width: 256, height: 256 }, 16 / 9)!;
    const answer = await solid(plan.width, plan.height, 150);

    const { image } = await compositeExpand(answer, src, plan);
    const before = await sharp(src).removeAlpha().raw().toBuffer();
    const after = await sharp(image)
      .extract({ left: plan.left, top: plan.top, width: 256, height: 256 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect(after).toEqual(before);
  });
});
