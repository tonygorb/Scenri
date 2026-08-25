import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { expandLocally } from '../src/expandLocal.js';
import { planExpand } from '../src/expandRules.js';

/** A picture with an unmistakable edge, so a mirror would be obvious. */
const source = async (w = 256, h = 256) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .composite([
      {
        input: await sharp({ create: { width: 12, height: h, channels: 3, background: { r: 20, g: 180, b: 60 } } })
          .png()
          .toBuffer(),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();

const raw = (buf: Buffer, region: { left: number; top: number; width: number; height: number }) =>
  sharp(buf).extract(region).removeAlpha().raw().toBuffer();

/** The jump across one row or column, against the picture's own variation. */
async function seamStep(buf: Buffer, axis: 'x' | 'y', at: number) {
  const { data, info } = await sharp(buf).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const line = (i: number) => {
    let sum = 0;
    if (axis === 'x') for (let y = 0; y < H; y++) sum += Math.abs(data[y * W + i] - data[y * W + i - 1]);
    else for (let x = 0; x < W; x++) sum += Math.abs(data[i * W + x] - data[(i - 1) * W + x]);
    return sum / (axis === 'x' ? H : W);
  };
  return line(at);
}

describe('growing a frame from the picture itself', () => {
  it('keeps every original pixel, byte for byte', async () => {
    const src = await source();
    for (const ratio of [16 / 9, 9 / 16]) {
      const plan = planExpand({ width: 256, height: 256 }, ratio)!;
      const out = await expandLocally(src, plan);
      const meta = await sharp(out).metadata();
      expect({ width: meta.width, height: meta.height }).toEqual({ width: plan.width, height: plan.height });
      expect(await raw(out, { left: plan.left, top: plan.top, width: 256, height: 256 })).toEqual(
        await raw(src, { left: 0, top: 0, width: 256, height: 256 }),
      );
    }
  });

  it('meets the picture with no step at all — the join is continuous by construction', async () => {
    const src = await source();
    const wide = planExpand({ width: 256, height: 256 }, 16 / 9)!;
    const grown = await expandLocally(src, wide);
    expect(await seamStep(grown, 'x', wide.left)).toBeLessThanOrEqual(0.5);
    expect(await seamStep(grown, 'x', wide.left + 256)).toBeLessThanOrEqual(0.5);

    const tall = planExpand({ width: 256, height: 256 }, 9 / 16)!;
    const grownTall = await expandLocally(src, tall);
    expect(await seamStep(grownTall, 'y', tall.top)).toBeLessThanOrEqual(0.5);
    expect(await seamStep(grownTall, 'y', tall.top + 256)).toBeLessThanOrEqual(0.5);
  });

  it('gives the same picture every time, so it can be re-run and compared', async () => {
    const src = await source();
    const plan = planExpand({ width: 256, height: 256 }, 16 / 9)!;
    const a = await expandLocally(src, plan);
    const b = await expandLocally(src, plan);
    expect(a.equals(b)).toBe(true);
  });

  it('carries the picture out of the join, and lets it go with distance', async () => {
    // the green stripe lives on the left edge, so the left margin must be
    // green against the join and must not still be green far away, or the
    // margin would read as a mirror rather than as a background
    const src = await source();
    const plan = planExpand({ width: 256, height: 256 }, 16 / 9)!;
    const out = await expandLocally(src, plan);
    const near = await raw(out, { left: plan.left - 4, top: 100, width: 4, height: 8 });
    const far = await raw(out, { left: 4, top: 100, width: 4, height: 8 });
    const greenLead = (px: Buffer) => {
      let r = 0;
      let g = 0;
      for (let i = 0; i < px.length; i += 3) {
        r += px[i];
        g += px[i + 1];
      }
      return g - r;
    };
    expect(greenLead(near)).toBeGreaterThan(0);
    expect(greenLead(far)).toBeLessThan(greenLead(near));
  });

  it('has nothing to do when the shape already fits', () => {
    // the planner is what decides there is no work; this function is only ever
    // handed a plan, so it never has to answer the question itself
    expect(planExpand({ width: 256, height: 256 }, 1)).toBeNull();
  });
});
