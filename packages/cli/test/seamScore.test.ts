import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { seamScore, SEAM_VISIBLE } from '../src/seamScore.js';
import { planExpand } from '../src/expandRules.js';

const SRC = { width: 256, height: 256 };
const plan = planExpand(SRC, 16 / 9)!;

/** A frame whose margin continues the picture's tone, with a given step at the join. */
async function frame(step: number): Promise<Buffer> {
  const noise = (v: number) =>
    sharp({
      create: {
        width: plan.width,
        height: plan.height,
        channels: 3,
        background: { r: v, g: v, b: v },
        noise: { type: 'gaussian' as const, mean: v, sigma: 12 },
      },
    })
      .png()
      .toBuffer();
  const margin = await noise(120);
  const picture = await sharp(await noise(120 + step))
    .extract({ left: 0, top: 0, width: SRC.width, height: SRC.height })
    .png()
    .toBuffer();
  return sharp(margin)
    .composite([{ input: picture, left: plan.left, top: plan.top }])
    .png()
    .toBuffer();
}

describe('scoring how much a join shows', () => {
  it('reads a continued surface as no worse than its own grain', async () => {
    expect(await seamScore(await frame(0), plan, SRC)).toBeLessThan(SEAM_VISIBLE);
  });

  it('reads a tonal step across the join as a visible line', async () => {
    expect(await seamScore(await frame(40), plan, SRC)).toBeGreaterThan(SEAM_VISIBLE);
  });

  it('says nothing is wrong when there is no grain to judge against', async () => {
    // a flat margin has no ordinary variation, so a ratio would divide by
    // almost nothing; that must not read as a catastrophic seam
    const flat = await sharp({
      create: { width: plan.width, height: plan.height, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .png()
      .toBuffer();
    expect(await seamScore(flat, plan, SRC)).toBeLessThanOrEqual(1);
  });

  it('grows with the size of the step, so "better" is a real comparison', async () => {
    const small = await seamScore(await frame(8), plan, SRC);
    const large = await seamScore(await frame(45), plan, SRC);
    expect(large).toBeGreaterThan(small);
  });
});
