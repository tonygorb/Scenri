import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { planExpand } from '../../src/expandRules.js';
import { CROP_ASSIST_MAX, cropAssistWindow, planGrowth, SINGLE_PASS_MAX } from '../../src/outpaint/growth.js';
import { MAX_SHARE, MIN_SHARE, placeExpand, subjectFraction } from '../../src/outpaint/place.js';

describe('planGrowth', () => {
  it('says nothing to do when the picture is already that shape', () => {
    expect(planGrowth({ width: 1024, height: 1024 }, 1)).toBeNull();
    // Same one percent tolerance planExpand uses, so the two cannot disagree.
    expect(planGrowth({ width: 1000, height: 1005 }, 1)).toBeNull();
  });

  it('treats an ordinary square to widescreen as one pass, untouched', () => {
    const g = planGrowth({ width: 1024, height: 1024 }, 16 / 9)!;
    expect(g.axis).toBe('width');
    expect(g.growth).toBeCloseTo(1.778, 2);
    expect(g.cropAssist).toBe(0);
    expect(g.stages).toBe(2);
  });

  it('leaves a small reshape as a single pass', () => {
    const g = planGrowth({ width: 1024, height: 1024 }, 4 / 3)!;
    expect(g.growth).toBeLessThanOrEqual(SINGLE_PASS_MAX);
    expect(g.stages).toBe(1);
    expect(g.cropAssist).toBe(0);
  });

  it('catches the widescreen to vertical case that had no bound at all', () => {
    // 1600x900 to 9:16 asks one pass to grow the height by 3.16. Nothing said so.
    const g = planGrowth({ width: 1600, height: 900 }, 9 / 16)!;
    expect(g.axis).toBe('height');
    expect(g.growth).toBeCloseTo(3.16, 1);
    expect(g.cropAssist).toBeGreaterThan(0);
    expect(g.cropAssist).toBeLessThanOrEqual(CROP_ASSIST_MAX);
    expect(g.effective).toBeLessThan(g.growth);
    expect(g.stages).toBeGreaterThan(1);
  });

  it('never lets crop assist take more than its cap, however extreme the ask', () => {
    const g = planGrowth({ width: 2000, height: 400 }, 9 / 16)!;
    expect(g.cropAssist).toBe(CROP_ASSIST_MAX);
  });

  it('cuts the axis that is not growing, centred, and only when asked to', () => {
    const source = { width: 1600, height: 900 };
    const tall = planGrowth(source, 9 / 16)!;
    const window = cropAssistWindow(source, tall)!;
    // Height grows, so width gives.
    expect(window.height).toBe(900);
    expect(window.width).toBeLessThan(1600);
    expect(window.left).toBe(Math.floor((1600 - window.width) / 2));

    const ordinary = planGrowth({ width: 1024, height: 1024 }, 16 / 9)!;
    expect(cropAssistWindow({ width: 1024, height: 1024 }, ordinary)).toBeNull();
  });
});

describe('placeExpand', () => {
  const source = { width: 1024, height: 1024 };
  const plan = planExpand(source, 16 / 9)!;

  it('centres a subject that is already centred, matching the old behaviour', () => {
    expect(placeExpand(plan, source, 0.5).left).toBe(plan.left);
  });

  it('gives more new canvas to the side the subject is furthest from', () => {
    // A bottle seven tenths across should stay seven tenths across, which puts
    // the wider margin on its left.
    const right = placeExpand(plan, source, 0.7);
    const left = placeExpand(plan, source, 0.3);
    expect(right.left).toBeGreaterThan(plan.left);
    expect(left.left).toBeLessThan(plan.left);
    expect(right.left + left.left).toBe(2 * plan.left);
  });

  it('keeps the frame and the picture exactly as planned, moving only the offset', () => {
    const moved = placeExpand(plan, source, 0.75);
    expect(moved.width).toBe(plan.width);
    expect(moved.height).toBe(plan.height);
    expect(moved.axis).toBe(plan.axis);
    expect(moved.top).toBe(plan.top);
    // The picture still fits with room to spare on both sides.
    expect(moved.left).toBeGreaterThanOrEqual(0);
    expect(moved.left + source.width).toBeLessThanOrEqual(moved.width);
  });

  it('never starves one side of the context it has to continue from', () => {
    const room = plan.width - source.width;
    for (const f of [0, 0.05, 0.95, 1]) {
      const p = placeExpand(plan, source, f);
      expect(p.left).toBeGreaterThanOrEqual(Math.round(room * MIN_SHARE));
      expect(p.left).toBeLessThanOrEqual(Math.round(room * MAX_SHARE));
    }
  });

  it('leaves a plan alone when there is no new canvas to distribute', () => {
    const none = { ...plan, width: source.width };
    expect(placeExpand(none, source, 0.9)).toEqual(none);
  });
});

describe('subjectFraction', () => {
  /** A flat field with one high-entropy block well off centre. */
  const offCentre = async (blockLeft: number) => {
    const noise = await sharp({
      create: {
        width: 160,
        height: 160,
        channels: 3,
        background: { r: 128, g: 128, b: 128 },
        noise: { type: 'gaussian' as const, mean: 128, sigma: 60 },
      },
    })
      .png()
      .toBuffer();
    return sharp({ create: { width: 640, height: 400, channels: 3, background: { r: 205, g: 205, b: 205 } } })
      .composite([{ input: noise, left: blockLeft, top: 120 }])
      .png()
      .toBuffer();
  };

  it('follows the subject, and reads past the middle when it sits past the middle', async () => {
    const src = { width: 640, height: 400 };
    const right = await subjectFraction(await offCentre(430), src, 'width');
    const left = await subjectFraction(await offCentre(50), src, 'width');
    expect(right).toBeGreaterThan(left);
    expect(right).toBeGreaterThan(0.5);
    expect(left).toBeLessThan(0.5);
  });

  it('stays softened toward the centre rather than trusting attention outright', async () => {
    // Averaged with the centre, so the reading can never leave the middle half.
    const src = { width: 640, height: 400 };
    for (const at of [0, 240, 480]) {
      const f = await subjectFraction(await offCentre(at), src, 'width');
      expect(f).toBeGreaterThanOrEqual(0.25);
      expect(f).toBeLessThanOrEqual(0.75);
    }
  });

  it('falls back to the centre on a picture it cannot read', async () => {
    expect(await subjectFraction(Buffer.from('not an image'), { width: 10, height: 10 }, 'width')).toBe(0.5);
  });
});
