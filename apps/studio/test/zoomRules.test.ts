import { describe, it, expect } from 'vitest';
import {
  centred,
  clampPan,
  fillScale,
  fitScale,
  isActual,
  isFill,
  isFit,
  limits,
  overflows,
  panBy,
  pinchView,
  toggleTarget,
  zoomBy,
  zoomLabel,
  zoomTo,
} from '../src/layout/detail/zoomRules.js';

const vp = { w: 1000, h: 800 };
const nat = { w: 2000, h: 2000 };
/** The frame the stage laid out: the picture at fit, 800px tall. */
const FIT = 0.4;

describe('fit, fill and limits', () => {
  it('fit sits inside the viewport and fill covers it, for each shape', () => {
    expect(fitScale(vp, { w: 2048, h: 2048 })).toBeCloseTo(800 / 2048);
    expect(fillScale(vp, { w: 2048, h: 2048 })).toBeCloseTo(1000 / 2048);
    expect(fitScale(vp, { w: 2048, h: 1152 })).toBeCloseTo(1000 / 2048);
    expect(fillScale(vp, { w: 2048, h: 1152 })).toBeCloseTo(800 / 1152);
    expect(fitScale(vp, { w: 1152, h: 2048 })).toBeCloseTo(800 / 2048);
  });

  it('runs from the smaller of fit and actual to the largest of fit, fill and three times actual', () => {
    const l = limits(FIT, vp, nat);
    expect(l.actual).toBe(1);
    expect(l.min).toBe(FIT);
    expect(l.fill).toBe(0.5);
    expect(l.max).toBe(3);
    // a picture whose fill is already past three times actual stops at fill
    const tiny = limits(4, vp, { w: 200, h: 200 });
    expect(tiny.max).toBe(5);
    expect(tiny.min).toBe(1);
  });
});

describe('zoom and pan', () => {
  const l = limits(FIT, vp, nat);

  it('a centred view is centred, and clamping leaves it there', () => {
    const v = centred(FIT, vp, nat);
    expect(v.tx).toBe(100);
    expect(v.ty).toBe(0);
    expect(clampPan(v, vp, nat)).toEqual(v);
  });

  it('keeps the picture point under the cursor fixed while zooming, past fit as well as inside it', () => {
    const v = centred(FIT, vp, nat);
    for (const [px, py, next] of [
      [600, 300, 0.45],
      [600, 300, 2],
    ]) {
      const before = { x: (px - v.tx) / v.scale, y: (py - v.ty) / v.scale };
      const z = zoomTo(v, next, px, py, vp, nat, l);
      expect(z.scale).toBe(next);
      expect((px - z.tx) / z.scale).toBeCloseTo(before.x, 6);
      expect((py - z.ty) / z.scale).toBeCloseTo(before.y, 6);
    }
  });

  it('clamps the scale to the limits and the pan to the edges', () => {
    const v = centred(FIT, vp, nat);
    expect(zoomBy(v, 100, 500, 400, vp, nat, l).scale).toBe(3);
    expect(zoomBy(v, 0.0001, 500, 400, vp, nat, l).scale).toBe(l.min);
    const z = zoomTo(v, 1, 500, 400, vp, nat, l);
    const dragged = panBy(z, 5000, -5000, vp, nat);
    expect(dragged.tx).toBe(0);
    expect(dragged.ty).toBe(vp.h - 2000);
  });

  it('a picture that fits stays inside the viewport however it is dragged', () => {
    const wide = { w: 2000, h: 500 };
    const lw = limits(0.5, vp, wide);
    const v = centred(0.5, vp, wide);
    expect(v).toEqual({ scale: 0.5, tx: 0, ty: 275 });
    const d = panBy(v, 300, 300, vp, wide);
    expect(d.tx).toBe(0);
    expect(d.ty).toBe(800 - 250);
    expect(panBy(v, -300, -300, vp, wide).ty).toBe(0);
    expect(overflows(v, vp, wide)).toBe(false);
    expect(overflows(zoomTo(v, 1, 0, 0, vp, wide, lw), vp, wide)).toBe(true);
  });

  it('a step in and a step out land back on fit', () => {
    const v = centred(FIT, vp, nat);
    const back = zoomBy(zoomBy(v, 1.25, 500, 400, vp, nat, l), 1 / 1.25, 500, 400, vp, nat, l);
    expect(isFit(back.scale, l)).toBe(true);
    expect(back.tx).toBeCloseTo(v.tx);
    expect(back.ty).toBeCloseTo(v.ty);
  });

  it('a pinch scales about the fingers and follows their midpoint', () => {
    const v = centred(FIT, vp, nat);
    const from = { a: { x: 400, y: 400 }, b: { x: 600, y: 400 } };
    const to = { a: { x: 300, y: 450 }, b: { x: 700, y: 450 } };
    const z = pinchView(v, from, to, vp, nat, l);
    expect(z.scale).toBeCloseTo(v.scale * 2);
    const p = { x: (500 - v.tx) / v.scale, y: (400 - v.ty) / v.scale };
    expect((500 - z.tx) / z.scale).toBeCloseTo(p.x, 6);
    expect((450 - z.ty) / z.scale).toBeCloseTo(p.y, 6);
  });
});

describe('labels and toggles', () => {
  it("says Fit at fit, Fill at fill, 100% at the picture's own size, else the percent of it", () => {
    const l = limits(FIT, vp, nat);
    expect(zoomLabel(FIT, l)).toBe('Fit');
    expect(zoomLabel(0.5, l)).toBe('Fill');
    expect(zoomLabel(1, l)).toBe('100%');
    expect(zoomLabel(1.5, l)).toBe('150%');
    expect(zoomLabel(0.7, l)).toBe('70%');
    expect(isFill(0.5, l)).toBe(true);
    expect(isActual(1, l)).toBe(true);
  });

  it('a double click goes to actual size when that is a closer look, else twice fit, and back', () => {
    const l = limits(FIT, vp, nat);
    expect(toggleTarget(FIT, l)).toBe(1);
    expect(toggleTarget(1, l)).toBe(FIT);
    const ls = limits(1, vp, { w: 400, h: 400 });
    expect(toggleTarget(1, ls)).toBe(2);
  });
});
