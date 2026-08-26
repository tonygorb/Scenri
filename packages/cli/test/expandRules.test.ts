import { describe, it, expect } from 'vitest';
import {
  planExpand,
  expandInstruction,
  ratioLabel,
  reframeInstruction,
  continueInstruction,
} from '../src/expandRules.js';

const SQUARE = { width: 1024, height: 1024 };

describe('planning an expansion', () => {
  // The guarantee rests on this: the source is surrounded, never scaled, so
  // every one of its pixels survives at its own resolution.
  it('keeps every row when the frame grows wider', () => {
    const plan = planExpand(SQUARE, 16 / 9)!;
    expect(plan.axis).toBe('width');
    expect(plan.height).toBe(1024);
    expect(plan.width).toBeGreaterThan(1024);
    expect(plan.width / plan.height).toBeCloseTo(16 / 9, 2);
    // centred, so the picture does not lurch sideways when its frame grows
    expect(plan.left).toBe(Math.round((plan.width - 1024) / 2));
    expect(plan.top).toBe(0);
  });

  it('keeps every column when the frame grows taller', () => {
    const plan = planExpand(SQUARE, 9 / 16)!;
    expect(plan.axis).toBe('height');
    expect(plan.width).toBe(1024);
    expect(plan.height).toBeGreaterThan(1024);
    expect(plan.width / plan.height).toBeCloseTo(9 / 16, 2);
    expect(plan.left).toBe(0);
    expect(plan.top).toBe(Math.round((plan.height - 1024) / 2));
  });

  it('leaves the source room to sit at its own size, exactly', () => {
    for (const ratio of [16 / 9, 9 / 16, 4 / 5, 5 / 4]) {
      const plan = planExpand(SQUARE, ratio);
      if (!plan) continue;
      expect(plan.width).toBeGreaterThanOrEqual(SQUARE.width);
      expect(plan.height).toBeGreaterThanOrEqual(SQUARE.height);
      expect(plan.left + SQUARE.width).toBeLessThanOrEqual(plan.width);
      expect(plan.top + SQUARE.height).toBeLessThanOrEqual(plan.height);
    }
  });

  it('does nothing when the shape already matches', () => {
    expect(planExpand(SQUARE, 1)).toBeNull();
    expect(planExpand({ width: 1024, height: 576 }, 16 / 9)).toBeNull();
  });

  // Any ratio is reachable by growing one axis, so THIS op never costs a
  // pixel: a 16:9 asked for as a square grows taller rather than losing its
  // sides. Cutting down to the shape instead is the other op — cropRules.ts —
  // and the caller chooses between them explicitly.
  it('reaches any shape by growing; cutting down is cropRules, not this op', () => {
    const wide = planExpand({ width: 1820, height: 1024 }, 1)!;
    expect(wide.axis).toBe('height');
    expect(wide.width).toBe(1820);
    expect(wide.height).toBeGreaterThan(1024);

    const tall = planExpand({ width: 1024, height: 1820 }, 1)!;
    expect(tall.axis).toBe('width');
    expect(tall.height).toBe(1820);
    expect(tall.width).toBeGreaterThan(1024);
  });

  it('refuses nonsense rather than guessing', () => {
    expect(planExpand({ width: 0, height: 1024 }, 1.5)).toBeNull();
    expect(planExpand(SQUARE, 0)).toBeNull();
  });

  it('lands on a multiple of eight, like every other frame in the product', () => {
    for (const ratio of [16 / 9, 9 / 16, 4 / 5, 3 / 2]) {
      const plan = planExpand(SQUARE, ratio);
      if (!plan) continue;
      expect(plan.width % 8).toBe(0);
      expect(plan.height % 8).toBe(0);
    }
  });
});

describe('what the engine is asked for', () => {
  it('describes the margin, and forbids touching the picture', () => {
    const plan = planExpand(SQUARE, 16 / 9)!;
    const text = expandInstruction(plan, '');
    expect(text).toContain('left and right');
    expect(text).toContain('change only the blurred margin');
    expect(text).toContain('keep the sharp photograph unchanged');
    expect(text).toContain('Avoid: new objects, products, people');
  });

  it('names the other axis when the frame grows the other way', () => {
    const plan = planExpand(SQUARE, 9 / 16)!;
    expect(expandInstruction(plan, '')).toContain('top and bottom');
  });

  it('carries the user own words when they gave any', () => {
    const plan = planExpand(SQUARE, 16 / 9)!;
    expect(expandInstruction(plan, 'more of the same stone ledge')).toContain('more of the same stone ledge');
    // and never names a texture: naming grain is what made the margins grainier
    expect(expandInstruction(plan, '')).not.toContain('grain');
  });
});

describe('the expansion instruction names the geometry it is asking for', () => {
  it('tells a vertical growth which way the plane runs', () => {
    const plan = planExpand(SQUARE, 9 / 16)!;
    const text = expandInstruction(plan, '');
    expect(text).toContain('top and bottom');
    // camera-relative, not a rate of change: this model family answers where
    // the camera is far better than how much bigger something gets
    expect(text).toContain('nearest the camera');
    expect(text).toContain('furthest away');
  });

  it('says nothing about receding planes when the frame grows sideways', () => {
    const plan = planExpand(SQUARE, 16 / 9)!;
    const text = expandInstruction(plan, '');
    expect(text).toContain('left and right');
    expect(text).not.toContain('nearest the camera');
  });
});

describe('ratioLabel', () => {
  it('names the shapes a person picked', () => {
    expect(ratioLabel(1824, 1024)).toBe('16:9');
    expect(ratioLabel(1024, 1824)).toBe('9:16');
    expect(ratioLabel(1024, 1280)).toBe('4:5');
    expect(ratioLabel(1024, 1024)).toBe('1:1');
  });

  it('reduces anything it cannot name', () => {
    expect(ratioLabel(1000, 700)).toBe('10:7');
  });
});

describe('reframeInstruction', () => {
  const src = { width: 1024, height: 1024 };

  it('names the shape, because the codex path cannot request a size', () => {
    const plan = planExpand(src, 16 / 9);
    if (!plan) throw new Error('expected a plan');
    const text = reframeInstruction(plan, src, '');
    expect(text).toContain('16:9');
    expect(text).toContain('wider');
    expect(text).toContain('to the left and to the right');
  });

  it('says where the supplied photograph sits in the result', () => {
    const plan = planExpand(src, 16 / 9);
    if (!plan) throw new Error('expected a plan');
    const text = reframeInstruction(plan, src, '');
    // 1024 of 1824 is 56%: stated as a place, not as a growth factor.
    expect(text).toContain("the middle 56% of the new frame's width");
  });

  it('never tells the model to zoom out, which shrinks the subject', () => {
    for (const ratio of [16 / 9, 9 / 16, 4 / 5]) {
      const plan = planExpand(src, ratio);
      if (!plan) continue;
      const text = reframeInstruction(plan, src, '').toLowerCase();
      expect(text).not.toContain('zoom');
      expect(text).not.toContain('pull back');
      expect(text).not.toContain('further away');
    }
  });

  it('does not name grain or a lens, the two amplifiers already measured', () => {
    const plan = planExpand(src, 16 / 9);
    if (!plan) throw new Error('expected a plan');
    const text = reframeInstruction(plan, src, '').toLowerCase();
    expect(text).not.toContain('grain');
    expect(text).not.toContain('mm');
    expect(text).not.toContain('focal');
    expect(text).not.toContain('perspective');
  });

  it('keeps the depth fact only for a frame that grew taller', () => {
    const tall = planExpand(src, 9 / 16);
    const wide = planExpand(src, 16 / 9);
    if (!tall || !wide) throw new Error('expected plans');
    expect(reframeInstruction(tall, src, '')).toContain('nearest the camera');
    expect(reframeInstruction(wide, src, '')).not.toContain('nearest the camera');
  });

  it("carries the user's own words without a doubled full stop", () => {
    const plan = planExpand(src, 16 / 9);
    if (!plan) throw new Error('expected a plan');
    expect(reframeInstruction(plan, src, '. keep the logo legible')).toContain('\nAlso: keep the logo legible');
    expect(reframeInstruction(plan, src, '   ')).not.toContain('Also:');
  });
});

describe('continueInstruction', () => {
  const src = { width: 1024, height: 1024 };

  it('asks for the empty area, not a blurred one, and protects the picture', () => {
    const plan = planExpand(src, 16 / 9);
    if (!plan) throw new Error('expected a plan');
    const text = continueInstruction(plan, '');
    expect(text).toContain('Fill the empty area at the left and right');
    expect(text).toContain('change only the empty area');
    expect(text).toContain('unchanged in position, scale and content');
    // The bed's wording would be a lie about a padded canvas.
    expect(text).not.toContain('blurred');
  });

  it('keeps the depth fact only for a frame that grew taller', () => {
    const tall = planExpand(src, 9 / 16);
    const wide = planExpand(src, 16 / 9);
    if (!tall || !wide) throw new Error('expected plans');
    expect(continueInstruction(tall, '')).toContain('nearest the camera');
    expect(continueInstruction(wide, '')).not.toContain('nearest the camera');
  });

  it('does not name grain or a lens', () => {
    const plan = planExpand(src, 16 / 9);
    if (!plan) throw new Error('expected a plan');
    const text = continueInstruction(plan, '').toLowerCase();
    expect(text).not.toContain('grain');
    expect(text).not.toContain('focal');
  });

  it('states the unchanged axis as a fact about the frame, only when asked', () => {
    const wide = planExpand(src, 16 / 9);
    if (!wide) throw new Error('expected a plan');
    expect(continueInstruction(wide, '')).not.toContain('Geometry:');

    const anchored = continueInstruction(wide, '', { anchorUnchangedAxis: true });
    // A wider frame keeps every row, so the vertical edges are the same edges.
    expect(anchored).toContain("the photograph's top and bottom edges are already the top and bottom edges");
    expect(anchored).toContain('nothing in it becomes smaller');
    expect(anchored).toContain('gains width only');
  });

  it('anchors the other axis when the frame grew taller', () => {
    const tall = planExpand(src, 9 / 16);
    if (!tall) throw new Error('expected a plan');
    const anchored = continueInstruction(tall, '', { anchorUnchangedAxis: true });
    expect(anchored).toContain("the photograph's left and right edges are already");
    expect(anchored).toContain('gains height only');
  });

  it('the anchor it states is true of the plan it was given', () => {
    // The claim is only safe because planExpand never scales the source: it
    // keeps one axis exactly and grows the other. Guard that here, so the
    // wording cannot outlive the geometry it describes.
    const wide = planExpand(src, 16 / 9);
    const tall = planExpand(src, 9 / 16);
    if (!wide || !tall) throw new Error('expected plans');
    expect(wide.height).toBe(src.height);
    expect(wide.top).toBe(0);
    expect(tall.width).toBe(src.width);
    expect(tall.left).toBe(0);
  });
});
