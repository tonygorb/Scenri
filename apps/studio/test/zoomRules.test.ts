import { describe, it, expect } from 'vitest';
import {
  actualScale,
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
  showsPixels,
  toggleTarget,
  zoomBy,
  zoomLabel,
  zoomTo,
} from '../src/layout/detail/zoomRules.js';

const vp = { w: 1000, h: 800 };
const nat = { w: 2000, h: 2000 };
/** The frame the stage laid out: the picture at fit, 800px tall. */
const FIT = 0.4;
const centred = (l: ReturnType<typeof limits>) => clampPan({ scale: l.fit, tx: 0, ty: 0 }, vp, nat);

describe('fit, fill and limits', () => {
  it('fit sits inside the viewport and fill covers it, for each shape', () => {
    expect(fitScale(vp, { w: 2048, h: 2048 })).toBeCloseTo(800 / 2048);
    expect(fillScale(vp, { w: 2048, h: 2048 })).toBeCloseTo(1000 / 2048);
    expect(fitScale(vp, { w: 2048, h: 1152 })).toBeCloseTo(1000 / 2048);
    expect(fillScale(vp, { w: 2048, h: 1152 })).toBeCloseTo(800 / 1152);
    expect(fitScale(vp, { w: 1152, h: 2048 })).toBeCloseTo(800 / 2048);
  });

  it('actual size is one image pixel per device pixel', () => {
    expect(actualScale(1)).toBe(1);
    expect(actualScale(2)).toBe(0.5);
  });

  it('runs from the smaller of fit and actual to the largest of fit, fill and three times actual', () => {
    const l = limits(FIT, vp, nat, 1);
    expect(l.min).toBe(FIT);
    expect(l.fill).toBe(0.5);
    expect(l.max).toBe(3);
    const hi = limits(FIT, vp, nat, 2);
    expect(hi.min).toBe(FIT);
    expect(hi.actual).toBe(0.5);
    expect(hi.max).toBe(1.5);
    // a picture whose fit is already past three times actual stops at fit
    const tiny = limits(4, vp, { w: 200, h: 200 }, 1);
    expect(tiny.max).toBe(5);
    expect(tiny.min).toBe(1);
  });
});

describe('zoom and pan', () => {
  const l = limits(FIT, vp, nat, 1);

  it('keeps the picture point under the cursor fixed while zooming', () => {
    const v = centred(l);
    const px = 600;
    const py = 300;
    const before = { x: (px - v.tx) / v.scale, y: (py - v.ty) / v.scale };
    const z = zoomTo(v, 2, px, py, vp, nat, l);
    expect(z.scale).toBe(2);
    expect((px - z.tx) / z.scale).toBeCloseTo(before.x, 6);
    expect((py - z.ty) / z.scale).toBeCloseTo(before.y, 6);
  });

  it('clamps the scale to the limits and the pan to the edges', () => {
    const v = centred(l);
    expect(zoomBy(v, 100, 500, 400, vp, nat, l).scale).toBe(3);
    expect(zoomBy(v, 0.0001, 500, 400, vp, nat, l).scale).toBe(l.min);
    const z = zoomTo(v, 1, 500, 400, vp, nat, l);
    const dragged = panBy(z, 5000, -5000, vp, nat);
    expect(dragged.tx).toBe(0);
    expect(dragged.ty).toBe(vp.h - 2000);
  });

  it('an axis that fits stays centred however it is dragged', () => {
    const wide = { w: 2000, h: 500 };
    const lw = limits(0.5, vp, wide, 1);
    const v = clampPan({ scale: 0.5, tx: 0, ty: 0 }, vp, wide);
    const d = panBy(v, 300, 300, vp, wide);
    expect(d.tx).toBe(0);
    expect(d.ty).toBe((800 - 250) / 2);
    expect(overflows(v, vp, wide)).toBe(false);
    expect(overflows(zoomTo(v, 1, 0, 0, vp, wide, lw), vp, wide)).toBe(true);
  });

  it('a step in and a step out land back on fit', () => {
    const v = centred(l);
    const back = zoomBy(zoomBy(v, 1.25, 500, 400, vp, nat, l), 1 / 1.25, 500, 400, vp, nat, l);
    expect(isFit(back.scale, l)).toBe(true);
    expect(back.tx).toBeCloseTo(v.tx);
    expect(back.ty).toBeCloseTo(v.ty);
  });

  it('a pinch scales about the fingers and follows their midpoint', () => {
    const v = centred(l);
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
  it('says Fit at fit, Fill at fill, 100% at actual, else the percent of actual', () => {
    const l1 = limits(FIT, vp, nat, 1);
    expect(zoomLabel(FIT, l1, 1)).toBe('Fit');
    expect(zoomLabel(0.5, l1, 1)).toBe('Fill');
    expect(zoomLabel(1, l1, 1)).toBe('100%');
    expect(zoomLabel(1.5, l1, 1)).toBe('150%');
    const l2 = limits(FIT, vp, nat, 2);
    expect(zoomLabel(0.5, l2, 2)).toBe('Fill');
    expect(zoomLabel(0.75, l2, 2)).toBe('150%');
    expect(isFill(0.5, l2)).toBe(true);
    expect(isActual(0.5, l2)).toBe(true);
  });

  it('a double click goes to actual size when that is a closer look, else twice fit, and back', () => {
    const l = limits(FIT, vp, nat, 1);
    expect(toggleTarget(FIT, l)).toBe(1);
    expect(toggleTarget(1, l)).toBe(FIT);
    const ls = limits(1, vp, { w: 400, h: 400 }, 1);
    expect(toggleTarget(1, ls)).toBe(2);
  });

  it('shows real pixels from two device pixels per image pixel', () => {
    expect(showsPixels(1.9, 1)).toBe(false);
    expect(showsPixels(2, 1)).toBe(true);
    expect(showsPixels(1, 2)).toBe(true);
  });
});
