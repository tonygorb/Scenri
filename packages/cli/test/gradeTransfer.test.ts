import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { gradeComposite, isGradeOnlyInstruction, GRADE_GATE_MEAN_DELTA } from '../src/gradeTransfer.js';
import { scopeOfInstruction } from '../src/editScopeRules.js';

// A textured test card: gradient + noise, so a grade is measurable and
// geometry changes are distinguishable from tone changes.
const card = async (w: number, h: number, tint = 0) => {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const g = Math.round((x / w) * 200) + ((x * 7 + y * 13) % 17);
      raw[i] = Math.min(255, g + tint);
      raw[i + 1] = Math.min(255, g);
      raw[i + 2] = Math.min(255, Math.max(0, g - tint));
    }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
};

/** The same card graded warmer through sharp itself: a true global grade. */
const warmed = (png: Buffer) =>
  sharp(png).modulate({ brightness: 1.1, saturation: 1.15 }).tint('#ffd9b0').png().toBuffer();

describe('isGradeOnlyInstruction', () => {
  it('accepts the tonal sentences a drill actually uses', () => {
    for (const t of [
      'slightly warmer light',
      'cooler, overcast light',
      'deeper shadows',
      'a touch more contrast',
      'make the lighting slightly softer',
      'warmer light again',
    ])
      expect(isGradeOnlyInstruction(t), t).toBe(true);
  });
  it('every tonal sentence is also a global relight, so the grade path and the scope verdict agree', () => {
    for (const t of [
      'slightly warmer light',
      'cooler, overcast light',
      'deeper shadows',
      'a touch more contrast',
      'make the lighting slightly softer',
      'warmer light again',
    ]) {
      const v = scopeOfInstruction(t);
      expect(v.scope, t).toBe('global');
      expect(v.relights, t).toBe(true);
      expect(isGradeOnlyInstruction(t), t).toBe(true);
    }
  });

  it('refuses anything that names a thing or an action on one', () => {
    for (const t of [
      'remove the cup on the left',
      'warmer light and fix the collar',
      'make the skin more natural',
      'move her hand',
      'add rain',
      '',
    ])
      expect(isGradeOnlyInstruction(t), t).toBe(false);
  });
});

describe('gradeComposite', () => {
  it('recovers a true grade and ships the original pixels at full size', async () => {
    const original = await card(640, 800);
    const modelInput = await sharp(original).resize(320, 400).png().toBuffer();
    const modelOutput = await warmed(modelInput);
    const r = await gradeComposite(original, modelInput, modelOutput);
    expect(r).not.toBeNull();
    expect(r!.residual).toBeLessThan(GRADE_GATE_MEAN_DELTA);
    const meta = await sharp(r!.image).metadata();
    // the ORIGINAL's size, not the model input's - a stepped-down chain gets
    // its full resolution back on a grade hop
    expect([meta.width, meta.height]).toEqual([640, 800]);
    // and it is genuinely warmer than the original
    const stats = async (b: Buffer) => (await sharp(b).stats()).channels.map((c) => c.mean);
    const [ro, , bo] = await stats(original);
    const [rg, , bg] = await stats(r!.image);
    expect(rg - bg).toBeGreaterThan(ro - bo);
  });

  it('a blown highlight stays white through a strong warm grade', async () => {
    const original = await card(640, 800);
    // burn a clipped white window into the original
    const withWindow = await sharp(original)
      .composite([
        {
          input: await sharp({ create: { width: 120, height: 200, channels: 3, background: '#ffffff' } })
            .png()
            .toBuffer(),
          left: 8,
          top: 100,
        },
      ])
      .png()
      .toBuffer();
    const modelInput = await sharp(withWindow).resize(320, 400).png().toBuffer();
    const modelOutput = await warmed(modelInput);
    const r = await gradeComposite(withWindow, modelInput, modelOutput);
    expect(r).not.toBeNull();
    // sample the window region of the graded original: still near-neutral.
    // (extract must be materialized first - sharp's stats() reads the INPUT
    // image and ignores chained operations.)
    const windowPng = await sharp(r!.image).extract({ left: 20, top: 150, width: 80, height: 100 }).png().toBuffer();
    const region = await sharp(windowPng).stats();
    const [mr, , mb] = region.channels.map((c) => c.mean);
    expect(Math.abs(mr - mb)).toBeLessThan(8);
  });

  it('refuses a grade fitted to an unrelated frame', async () => {
    const original = await card(640, 800);
    const modelInput = await sharp(original).resize(320, 400).png().toBuffer();
    // an unrelated frame: inverted, rotated, structurally different - the
    // catastrophe class the gate exists for (measured 80 vs tonal hops 10-25)
    const unrelated = await sharp(modelInput).negate().rotate(90).resize(320, 400, { fit: 'fill' }).png().toBuffer();
    const r = await gradeComposite(original, modelInput, unrelated);
    expect(r).toBeNull();
  });
});
