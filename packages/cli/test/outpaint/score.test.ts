import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { planExpand } from '../../src/expandRules.js';
import { RESIDUAL_INVISIBLE, RESIDUAL_VISIBLE, seamPenalty, seamResidual } from '../../src/outpaint/score.js';

const solid = (w: number, h: number, v: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: v, g: v, b: v } } })
    .png()
    .toBuffer();

const plan = planExpand({ width: 256, height: 256 }, 16 / 9)!;

/** A finished frame: margins at one level, the picture at another. */
const frame = async (margin: number, picture: number) =>
  sharp(await solid(plan.width, plan.height, margin))
    .composite([{ input: await solid(256, 256, picture), left: plan.left, top: plan.top }])
    .png()
    .toBuffer();

describe('seamResidual', () => {
  it('is zero when the margin and the picture agree', async () => {
    expect(await seamResidual(await frame(150, 150), plan, { width: 256, height: 256 })).toBeCloseTo(0, 5);
  });

  it('reads a tonal step at its true size in levels', async () => {
    expect(await seamResidual(await frame(120, 150), plan, { width: 256, height: 256 })).toBeCloseTo(30, 5);
  });

  it('puts an invisible join below the published threshold and a bad one above it', async () => {
    const fine = await seamResidual(await frame(148, 150), plan, { width: 256, height: 256 });
    const bad = await seamResidual(await frame(110, 150), plan, { width: 256, height: 256 });
    expect(fine).toBeLessThan(RESIDUAL_INVISIBLE);
    expect(bad).toBeGreaterThan(RESIDUAL_VISIBLE);
  });

  it('reports the worse of the two joins, not their average', async () => {
    const uneven = await sharp(await solid(plan.width, plan.height, 150))
      .composite([
        { input: await solid(plan.left, plan.height, 150), left: 0, top: 0 },
        { input: await solid(plan.left, plan.height, 100), left: plan.left + 256, top: 0 },
        { input: await solid(256, 256, 150), left: plan.left, top: plan.top },
      ])
      .png()
      .toBuffer();
    expect(await seamResidual(uneven, plan, { width: 256, height: 256 })).toBeCloseTo(50, 5);
  });
});

describe('seamPenalty', () => {
  it('is 1 at either threshold and refuses to average a good half with a bad one', () => {
    expect(seamPenalty(2.2, 0)).toBeCloseTo(1, 5);
    expect(seamPenalty(0, 15)).toBeCloseTo(1, 5);
    // Perfect grain ratio, plainly visible tonal step: still a losing candidate.
    expect(seamPenalty(0.5, 30)).toBeGreaterThan(seamPenalty(2.0, 5));
  });
});
