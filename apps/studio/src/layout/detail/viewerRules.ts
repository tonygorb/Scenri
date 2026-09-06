/**
 * The arithmetic behind the image viewer, free of React and the DOM so
 * `test/viewerRules.test.ts` covers it directly.
 *
 * Everything is in CSS pixels. The picture is drawn at `natural x scale` and
 * moved by `(tx, ty)` from the viewport's top-left, with its transform origin
 * at its own top-left, so a picture point `(x, y)` sits at `tx + x * scale`.
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
  /** The whole picture inside the viewport. */
  fit: number;
  /** One image pixel per device pixel. */
  actual: number;
  min: number;
  max: number;
}

/** Breathing room around a fitted picture. */
export const FIT_PAD = 24;
/** One step of the buttons and the keys. */
export const STEP = 1.25;
/** How far past actual size the viewer goes: three device pixels per image pixel is enough to read a seam. */
const MAX_OVER_ACTUAL = 3;
/** Two scales this close are the same scale: a step in and back out lands on floating-point dust. */
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.002 * Math.max(a, b);

/** The scale at which the whole picture sits inside the viewport with its padding. */
export function fitScale(viewport: Size, natural: Size, pad = FIT_PAD): number {
  const w = Math.max(1, viewport.w - pad * 2);
  const h = Math.max(1, viewport.h - pad * 2);
  return Math.min(w / natural.w, h / natural.h);
}

/** One image pixel per device pixel, which is the only honest "100%". */
export const actualScale = (dpr: number): number => 1 / Math.max(1, dpr);

export function limits(viewport: Size, natural: Size, dpr: number): Limits {
  const fit = fitScale(viewport, natural);
  const actual = actualScale(dpr);
  return { fit, actual, min: Math.min(fit, actual), max: Math.max(fit, actual * MAX_OVER_ACTUAL) };
}

export const clampScale = (s: number, l: Limits): number => Math.min(l.max, Math.max(l.min, s));

/** The picture centred on an axis where it fits, and pinned to the edges where it overflows. */
export function clampPan(v: View, viewport: Size, natural: Size): View {
  const w = natural.w * v.scale;
  const h = natural.h * v.scale;
  const tx = w <= viewport.w ? (viewport.w - w) / 2 : Math.min(0, Math.max(viewport.w - w, v.tx));
  const ty = h <= viewport.h ? (viewport.h - h) / 2 : Math.min(0, Math.max(viewport.h - h, v.ty));
  return { scale: v.scale, tx, ty };
}

/** The fitted view: the whole picture, centred. */
export function fitView(viewport: Size, natural: Size, l: Limits): View {
  return clampPan({ scale: l.fit, tx: 0, ty: 0 }, viewport, natural);
}

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
export const isActual = (scale: number, l: Limits): boolean => near(scale, l.actual);

/** What the label says: Fit, 100%, or the percent of actual size. */
export function zoomLabel(scale: number, l: Limits, dpr: number): string {
  if (isFit(scale, l)) return 'Fit';
  if (isActual(scale, l)) return '100%';
  return `${Math.round(scale * Math.max(1, dpr) * 100)}%`;
}

/**
 * Where a double click goes. From fit: to actual size when that is a closer
 * look, else to twice fit, within the limits. From anywhere else: back to fit.
 */
export function toggleTarget(scale: number, l: Limits): number {
  if (!isFit(scale, l)) return l.fit;
  return l.actual > l.fit * 1.05 ? l.actual : clampScale(l.fit * 2, l);
}

/** Past two device pixels per image pixel, interpolation would lie about the pixels; the blocks are shown instead. */
export const showsPixels = (scale: number, dpr: number): boolean => scale * Math.max(1, dpr) >= 2;

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
