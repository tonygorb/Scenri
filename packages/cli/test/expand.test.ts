import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { expandCanvas, compositeExpand } from '../src/expand.js';
import { planExpand, seamBandFor, type ExpandPlan } from '../src/expandRules.js';

/**
 * The guaranteed region: the source inset by the seam band on the seam-axis
 * edges only. Everything in here must be byte-identical; the band outside it
 * is a deterministic blend and is asserted separately.
 */
const guaranteed = (plan: ExpandPlan, w: number, h: number) => {
  const n = seamBandFor({ width: w, height: h });
  return plan.axis === 'width'
    ? { srcRegion: { left: n, top: 0, width: w - 2 * n, height: h }, outRegion: { left: plan.left + n, top: plan.top, width: w - 2 * n, height: h } }
    : { srcRegion: { left: 0, top: n, width: w, height: h - 2 * n }, outRegion: { left: plan.left, top: plan.top + n, width: w, height: h - 2 * n } };
};

/** A recognisable picture: red, with a green stripe so any shift is obvious. */
const source = async (w = 256, h = 256) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .composite([
      {
        input: await sharp({ create: { width: w, height: 16, channels: 3, background: { r: 20, g: 180, b: 60 } } })
          .png()
          .toBuffer(),
        left: 0,
        top: Math.round(h / 2),
      },
    ])
    .png()
    .toBuffer();

/** Whatever the engine felt like returning, at the right shape. */
const engineAnswer = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 40, b: 220 } } })
    .png()
    .toBuffer();

const pixels = async (buf: Buffer, region: { left: number; top: number; width: number; height: number }) =>
  sharp(buf).extract(region).removeAlpha().raw().toBuffer();

describe('expanding a frame', () => {
  it('hands the engine the real picture in place, on a bed made of its own edges', async () => {
    const src = await source();
    const plan = planExpand({ width: 256, height: 256 }, 16 / 9)!;
    const canvas = await expandCanvas(src, plan);

    const meta = await sharp(canvas).metadata();
    expect({ width: meta.width, height: meta.height }).toEqual({ width: plan.width, height: plan.height });
    // the picture itself is present, unmodified, where it was planned
    expect(await pixels(canvas, { left: plan.left, top: plan.top, width: 256, height: 256 })).toEqual(
      await pixels(src, { left: 0, top: 0, width: 256, height: 256 }),
    );
  });

  // This is the promise the whole path exists to make, and the only reason the
  // compositing pass is there: no provider we can reach guarantees an untouched
  // region, so it is taken rather than requested.
  it('returns the guaranteed region byte for byte, whatever the engine sent back', async () => {
    const src = await source();
    const plan = planExpand({ width: 256, height: 256 }, 16 / 9)!;
    const answer = await engineAnswer(plan.width, plan.height);

    const { image, aligned } = await compositeExpand(answer, src, plan);
    expect(aligned).toBe(true);

    const meta = await sharp(image).metadata();
    expect({ width: meta.width, height: meta.height }).toEqual({ width: plan.width, height: plan.height });
    const g = guaranteed(plan, 256, 256);
    expect(await pixels(image, g.outRegion)).toEqual(await pixels(src, g.srcRegion));
    // and the margin really did come from the engine, not from the bed
    const margin = await pixels(image, { left: 0, top: 0, width: 8, height: 8 });
    expect(margin[2]).toBeGreaterThan(margin[0]); // blue channel leads: the engine's colour
  });

  it('holds the original even when the engine answers at a different size', async () => {
    const src = await source();
    const plan = planExpand({ width: 256, height: 256 }, 16 / 9)!;
    // same shape, twice the pixels: a perfectly ordinary provider answer
    const answer = await engineAnswer(plan.width * 2, plan.height * 2);

    const { image, aligned } = await compositeExpand(answer, src, plan);
    expect(aligned).toBe(true);
    const g = guaranteed(plan, 256, 256);
    expect(await pixels(image, g.outRegion)).toEqual(await pixels(src, g.srcRegion));
  });

  // An engine that renders at its own native sizes answers a 1824x1024 request
  // with something like 1536x1024. That is perfectly usable margin, and
  // demanding the exact frame threw it away for a blurred bed.
  it('uses an answer of the same orientation even when the frame differs', async () => {
    const src = await source();
    const plan = planExpand({ width: 256, height: 256 }, 16 / 9)!;
    const answer = await engineAnswer(384, 256); // wide, but not the planned wide

    const { image, aligned } = await compositeExpand(answer, src, plan);
    expect(aligned).toBe(true);
    const margin = await pixels(image, { left: 0, top: 0, width: 8, height: 8 });
    expect(margin[2]).toBeGreaterThan(margin[0]); // the engine's blue, not a blurred red bed
    const g = guaranteed(plan, 256, 256);
    expect(await pixels(image, g.outRegion)).toEqual(await pixels(src, g.srcRegion));
  });

  it('keeps the bed and says so when the engine answers in the opposite orientation', async () => {
    const src = await source();
    const plan = planExpand({ width: 256, height: 256 }, 16 / 9)!;
    const answer = await engineAnswer(300, 900); // tall, where a wide margin was needed

    const { image, aligned } = await compositeExpand(answer, src, plan);
    expect(aligned).toBe(false);
    // the picture still survives: a bad margin is never allowed to cost the shot
    const g = guaranteed(plan, 256, 256);
    expect(await pixels(image, g.outRegion)).toEqual(await pixels(src, g.srcRegion));
  });

  it('grows the other way for a tall frame, and still preserves everything', async () => {
    const src = await source();
    const plan = planExpand({ width: 256, height: 256 }, 9 / 16)!;
    expect(plan.axis).toBe('height');
    const answer = await engineAnswer(plan.width, plan.height);

    const { image } = await compositeExpand(answer, src, plan);
    const g = guaranteed(plan, 256, 256);
    expect(await pixels(image, g.outRegion)).toEqual(await pixels(src, g.srcRegion));
  });

  it('the non-seam edges are byte-identical to the very last pixel', async () => {
    const src = await source();
    const plan = planExpand({ width: 256, height: 256 }, 16 / 9)!; // width axis: top/bottom are canvas edges
    const answer = await engineAnswer(plan.width, plan.height);
    const { image } = await compositeExpand(answer, src, plan);
    expect(await pixels(image, { left: plan.left + 20, top: 0, width: 64, height: 2 })).toEqual(
      await pixels(src, { left: 20, top: 0, width: 64, height: 2 }),
    );
    expect(await pixels(image, { left: plan.left + 20, top: 254, width: 64, height: 2 })).toEqual(
      await pixels(src, { left: 20, top: 254, width: 64, height: 2 }),
    );
  });

  it('the seam band is a real blend: neither pure source nor pure engine', async () => {
    const src = await source();
    const plan = planExpand({ width: 256, height: 256 }, 16 / 9)!;
    const answer = await engineAnswer(plan.width, plan.height); // flat blue
    const { image } = await compositeExpand(answer, src, plan);
    // outermost source column: red 200 blended toward the engine's 40
    const edge = await pixels(image, { left: plan.left, top: 8, width: 1, height: 1 });
    expect(edge[0]).toBeGreaterThan(45); // not pure engine
    expect(edge[0]).toBeLessThan(195); // not pure source
    // and one band-width in, the source is exact again
    const n = seamBandFor({ width: 256, height: 256 });
    const inside = await pixels(image, { left: plan.left + n, top: 8, width: 1, height: 1 });
    const srcInside = await pixels(src, { left: n, top: 8, width: 1, height: 1 });
    expect(inside).toEqual(srcInside);
  });

  it('seamBandFor keeps its bounds', () => {
    expect(seamBandFor({ width: 800, height: 600 })).toBe(8); // 1% of 800 = 8
    expect(seamBandFor({ width: 2400, height: 1600 })).toBe(16); // capped
    expect(seamBandFor({ width: 1000, height: 1000 })).toBe(10); // the 1% rule
    expect(seamBandFor({ width: 2000, height: 40 })).toBe(10); // shortEdge/4 clamp
  });
});
