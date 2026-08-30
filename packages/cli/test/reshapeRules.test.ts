import { describe, expect, it } from 'vitest';
import { classifyReshape, EXTEND_MAX, fitExpandToBudget, reshapeOpFor } from '../src/reshapeRules.js';
import { planExpand } from '../src/expandRules.js';
import { budgetSize } from '@scenri/core';

const CODEX_BUDGET = 1_572_864;

describe('classifyReshape', () => {
  it('same shape within one percent is nothing at all', () => {
    expect(classifyReshape({ width: 1024, height: 1024 }, 1.005)).toEqual({ op: 'none' });
  });

  it('nonsense input is nothing at all', () => {
    expect(classifyReshape({ width: 0, height: 1024 }, 16 / 9)).toEqual({ op: 'none' });
    expect(classifyReshape({ width: 1024, height: 1024 }, 0)).toEqual({ op: 'none' });
  });

  it('the flagship extends stay extends: 1:1 to 16:9 and 1:1 to 9:16', () => {
    for (const target of [16 / 9, 9 / 16]) {
      const d = classifyReshape({ width: 1254, height: 1254 }, target);
      expect(d.op).toBe('extend');
      if (d.op === 'extend') expect(d.assist).toBeNull();
    }
  });

  it('4:5 to 16:9 extends with crop assist, and the assist lands the growth on the bound', () => {
    const d = classifyReshape({ width: 1122, height: 1402 }, 16 / 9);
    expect(d.op).toBe('extend');
    if (d.op !== 'extend') return;
    expect(d.assist).not.toBeNull();
    expect(d.growth.cropAssist).toBeGreaterThan(0);
    expect(d.growth.cropAssist).toBeLessThanOrEqual(0.15);
    expect(d.growth.effective).toBeLessThanOrEqual(EXTEND_MAX + 1e-9);
    // The assist cuts the axis that is not growing: a wider frame keeps width.
    expect(d.assist!.width).toBe(1122);
    expect(d.assist!.height).toBeLessThan(1402);
  });

  it('16:9 to 9:16 is further than one extend can reach and becomes a forced crop', () => {
    const d = classifyReshape({ width: 1600, height: 900 }, 9 / 16);
    expect(d).toMatchObject({ op: 'crop', forced: true });
  });

  it('a squarer target with no explicit ask crops, never extends', () => {
    expect(classifyReshape({ width: 1600, height: 900 }, 1)).toMatchObject({ op: 'crop', forced: false });
    expect(classifyReshape({ width: 1080, height: 1920 }, 4 / 5)).toMatchObject({ op: 'crop', forced: false });
  });

  it('an explicit extend toward square is honoured when it fits the bound', () => {
    // 16:9 to 1:1 grows the height 1.78x: allowed, the user asked for sky and floor.
    const d = classifyReshape({ width: 1600, height: 900 }, 1, 'extend');
    expect(d.op).toBe('extend');
  });

  it('an explicit crop is always honoured', () => {
    expect(classifyReshape({ width: 1024, height: 1024 }, 16 / 9, 'crop')).toMatchObject({ op: 'crop', forced: false });
  });
});

describe('fitExpandToBudget', () => {
  it('a frame already under budget is untouched', () => {
    const plan = { width: 1824, height: 1024, left: 400, top: 0, axis: 'width' as const };
    const fit = fitExpandToBudget(plan, { width: 1024, height: 1024 }, CODEX_BUDGET * 2);
    expect(fit.scale).toBe(1);
    expect(fit.plan).toBe(plan);
  });

  it('no budget at all means no fit', () => {
    const plan = { width: 2496, height: 1402, left: 558, top: 0, axis: 'width' as const };
    expect(fitExpandToBudget(plan, { width: 1122, height: 1402 }, undefined).scale).toBe(1);
  });

  it('the failing node geometry: 1122x1402 to 16:9 fits inside the codex budget', () => {
    // The real numbers from node d2aef33c: the plan used to go out at
    // 2496x1402 = 3.5 megapixels and the answer was upscaled 1.49x to fill it.
    const plan = planExpand({ width: 1122, height: 1402 }, 16 / 9)!;
    expect(plan.width * plan.height).toBeGreaterThan(CODEX_BUDGET);
    const fit = fitExpandToBudget(plan, { width: 1122, height: 1402 }, CODEX_BUDGET);
    expect(fit.scale).toBeLessThan(1);
    expect(fit.plan.width * fit.plan.height).toBeLessThanOrEqual(CODEX_BUDGET * 1.01);
    // The unchanged axis is locked to the frame edge: no generated strip on
    // an edge the picture already owns.
    expect(fit.source.height).toBe(fit.plan.height);
    expect(fit.plan.top).toBe(0);
    // The source is scaled uniformly: its ratio survives within half a percent.
    const srcRatio = 1122 / 1402;
    const sentRatio = fit.source.width / fit.source.height;
    expect(Math.abs(sentRatio - srcRatio) / srcRatio).toBeLessThan(0.005);
    // The source still fits inside the frame at its offset.
    expect(fit.plan.left + fit.source.width).toBeLessThanOrEqual(fit.plan.width);
  });

  it('a vertical growth fits the same way', () => {
    const plan = planExpand({ width: 1254, height: 1254 }, 9 / 16)!;
    const fit = fitExpandToBudget(plan, { width: 1254, height: 1254 }, CODEX_BUDGET);
    expect(fit.scale).toBeLessThan(1);
    expect(fit.source.width).toBe(fit.plan.width);
    expect(fit.plan.left).toBe(0);
    expect(fit.plan.top + fit.source.height).toBeLessThanOrEqual(fit.plan.height);
  });

  it('the fitted frame is what the engine natively draws: budgetSize is idempotent on it', () => {
    // codexNativeSize(plan) must equal the plan itself, so the size the prompt
    // states, the size we ask for and the size the assembly expects agree.
    const plan = planExpand({ width: 1122, height: 1402 }, 16 / 9)!;
    const fit = fitExpandToBudget(plan, { width: 1122, height: 1402 }, CODEX_BUDGET);
    const again = budgetSize(fit.plan.width, fit.plan.height, CODEX_BUDGET);
    expect(Math.abs(again.width - fit.plan.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(again.height - fit.plan.height)).toBeLessThanOrEqual(1);
  });

  it('placement survives the scale: an off-centre subject stays off-centre', () => {
    const plan = { width: 2496, height: 1402, left: 200, top: 0, axis: 'width' as const };
    const fit = fitExpandToBudget(plan, { width: 1122, height: 1402 }, CODEX_BUDGET);
    const before = 200 / (2496 - 1122);
    const after = fit.plan.left / (fit.plan.width - fit.source.width);
    expect(Math.abs(after - before)).toBeLessThan(0.02);
  });
});

describe('reshapeOpFor', () => {
  // This table is duplicated verbatim in apps/studio/test/reshape.test.ts:
  // the two copies of the rule are pinned to the same answers.
  const table: Array<[string, number, number, 'extend' | 'crop']> = [
    ['square to landscape', 1, 16 / 9, 'extend'],
    ['square to story', 1, 9 / 16, 'extend'],
    ['square to portrait', 1, 4 / 5, 'extend'],
    ['portrait to landscape', 4 / 5, 16 / 9, 'extend'],
    ['portrait to story', 4 / 5, 9 / 16, 'extend'],
    ['landscape to square', 16 / 9, 1, 'crop'],
    ['landscape to portrait', 16 / 9, 4 / 5, 'crop'],
    ['story to portrait', 9 / 16, 4 / 5, 'crop'],
    ['landscape to story', 16 / 9, 9 / 16, 'crop'],
    ['story to landscape', 9 / 16, 16 / 9, 'crop'],
  ];
  for (const [name, src, target, want] of table) {
    it(`${name} is ${want}`, () => {
      expect(reshapeOpFor(src, target)).toBe(want);
    });
  }
});
