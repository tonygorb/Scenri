/**
 * The arithmetic behind zooming the picture on the stage, free of React and
 * the DOM so `test/zoomRules.test.ts` covers it directly.
 *
 * Everything is in CSS pixels. The picture is drawn at `natural x scale` and
 * moved by `(tx, ty)` from the viewport's top-left, with its transform origin
 * at its own top-left, so a picture point `(x, y)` sits at `tx + x * scale`.
 * The fit is not computed here: it is whatever the stage's own layout chose
 * for the frame, so at fit the transform is the identity and nothing moves.
 * 100% is the picture at its own pixel size in CSS pixels, the size the
 * browser gives an image it is not asked to resize; the stage never draws a
 * fit larger than that, so 100% is always at least fit.
 */

export interface Size {
  w: number;
  h: number;
}
export interface View {
  scale: number;
  tx: number;
  ty: number;
}
export interface Limits {
  /** The whole picture inside the viewport: the frame the layout drew. */
  fit: number;
  /** The picture covering the viewport. */
  fill: number;
  /** The picture at its own pixel size. */
  actual: number;
  min: number;
  max: number;
}

/** One step of the menu and the keys. */
export const STEP = 1.25;
/** How far past actual size the zoom goes: three CSS pixels per image pixel is enough to read a seam. */
const MAX_OVER_ACTUAL = 3;
/** Two scales this close are the same scale: a step in and back out lands on floating-point dust. */
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.002 * Math.max(a, b);

/** The scale at which the whole picture sits inside the viewport. */
export const fitScale = (viewport: Size, natural: Size): number =>
  Math.min(viewport.w / natural.w, viewport.h / natural.h);

/** The scale at which the picture covers the viewport. */
export const fillScale = (viewport: Size, natural: Size): number =>
  Math.max(viewport.w / natural.w, viewport.h / natural.h);

/** The picture at its own pixel size. */
export const ACTUAL = 1;

/**
 * The limits around a fit the layout already chose. The range runs from the
 * smaller of fit and actual to the largest of fit, fill and three times
 * actual, so a small picture can still be seen at its pixels and a large
 * one can still cover the stage.
 */
export function limits(fit: number, viewport: Size, natural: Size): Limits {
  const fill = fillScale(viewport, natural);
  return {
    fit,
    fill,
    actual: ACTUAL,
    min: Math.min(fit, ACTUAL),
    max: Math.max(fit, fill, ACTUAL * MAX_OVER_ACTUAL),
  };
}

export const clampScale = (s: number, l: Limits): number => Math.min(l.max, Math.max(l.min, s));

/**
 * The picture kept inside the viewport where it fits, and pinned to the
 * edges where it overflows. Not centred: a zoom about the cursor keeps the
 * point under the cursor where it is, and a picture snapped back to the
 * middle after every tick would slide out from under it.
 */
export function clampPan(v: View, viewport: Size, natural: Size): View {
  const w = natural.w * v.scale;
  const h = natural.h * v.scale;
  const tx =
    w <= viewport.w ? Math.min(viewport.w - w, Math.max(0, v.tx)) : Math.min(0, Math.max(viewport.w - w, v.tx));
  const ty =
    h <= viewport.h ? Math.min(viewport.h - h, Math.max(0, v.ty)) : Math.min(0, Math.max(viewport.h - h, v.ty));
  return { scale: v.scale, tx, ty };
}

/** The picture at `scale`, centred in the viewport. */
export function centred(scale: number, viewport: Size, natural: Size): View {
  return clampPan(
    { scale, tx: (viewport.w - natural.w * scale) / 2, ty: (viewport.h - natural.h * scale) / 2 },
    viewport,
    natural,
  );
}

/** The fitted view: the whole picture, centred. */
export const fitView = (viewport: Size, natural: Size, l: Limits): View => centred(l.fit, viewport, natural);

/** Scale to `next`, keeping the picture point under `(px, py)` where it is. */
export function zoomTo(v: View, next: number, px: number, py: number, viewport: Size, natural: Size, l: Limits): View {
  const s = clampScale(next, l);
  const k = s / v.scale;
  return clampPan({ scale: s, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k }, viewport, natural);
}

export function zoomBy(
  v: View,
  factor: number,
  px: number,
  py: number,
  viewport: Size,
  natural: Size,
  l: Limits,
): View {
  return zoomTo(v, v.scale * factor, px, py, viewport, natural, l);
}

export function panBy(v: View, dx: number, dy: number, viewport: Size, natural: Size): View {
  return clampPan({ scale: v.scale, tx: v.tx + dx, ty: v.ty + dy }, viewport, natural);
}

/** Whether the picture runs past the viewport on either axis, so a drag has somewhere to go. */
export function overflows(v: View, viewport: Size, natural: Size): boolean {
  return natural.w * v.scale > viewport.w + 0.5 || natural.h * v.scale > viewport.h + 0.5;
}

export const isFit = (scale: number, l: Limits): boolean => near(scale, l.fit);
export const isFill = (scale: number, l: Limits): boolean => near(scale, l.fill);
export const isActual = (scale: number, l: Limits): boolean => near(scale, l.actual);

/** What the reading says: Fit, Fill, 100%, or the percent of the picture's own size. */
export function zoomLabel(scale: number, l: Limits): string {
  if (isFit(scale, l)) return 'Fit';
  if (isFill(scale, l)) return 'Fill';
  if (isActual(scale, l)) return '100%';
  return `${Math.round(scale * 100)}%`;
}

/**
 * Where a double click goes. From fit: to actual size when that is a closer
 * look, else to twice fit, within the limits. From anywhere else: back to fit.
 */
export function toggleTarget(scale: number, l: Limits): number {
  if (!isFit(scale, l)) return l.fit;
  return l.actual > l.fit * 1.05 ? l.actual : clampScale(l.fit * 2, l);
}

export interface Pt {
  x: number;
  y: number;
}
export interface Pair {
  a: Pt;
  b: Pt;
}

/**
 * A pinch, from the view the fingers landed on: the scale follows their
 * distance, and the picture point that was under their midpoint stays under
 * it as it moves.
 */
export function pinchView(base: View, from: Pair, to: Pair, viewport: Size, natural: Size, l: Limits): View {
  const d0 = Math.hypot(from.b.x - from.a.x, from.b.y - from.a.y) || 1;
  const d1 = Math.hypot(to.b.x - to.a.x, to.b.y - to.a.y) || 1;
  const s = clampScale(base.scale * (d1 / d0), l);
  const m0 = { x: (from.a.x + from.b.x) / 2, y: (from.a.y + from.b.y) / 2 };
  const m1 = { x: (to.a.x + to.b.x) / 2, y: (to.a.y + to.b.y) / 2 };
  const px = (m0.x - base.tx) / base.scale;
  const py = (m0.y - base.ty) / base.scale;
  return clampPan({ scale: s, tx: m1.x - px * s, ty: m1.y - py * s }, viewport, natural);
}
