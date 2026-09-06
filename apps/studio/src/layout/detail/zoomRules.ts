/**
 * The arithmetic behind the loupe on the stage, free of React and the DOM so
 * `test/zoomRules.test.ts` covers it directly.
 *
 * Everything is in CSS pixels. The picture is drawn at `natural x scale` and
 * moved by `(tx, ty)` from the viewport's top-left, with its transform origin
 * at its own top-left, so a picture point `(x, y)` sits at `tx + x * scale`.
 * The fit is not computed here: it is whatever the stage's own layout chose
 * for the frame, so at fit the transform is the identity and nothing moves.
 * Actual size is the picture at its own pixel size in CSS pixels, the size
 * the browser gives an image it is not asked to resize; the stage never
 * draws a fit larger than that.
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
  /** The picture at its own pixel size. */
  actual: number;
  /** Where the click takes it: actual size when that is a closer look, else twice fit. */
  look: number;
  min: number;
  /** How far a pinch can go past the look. */
  max: number;
}

/** The picture at its own pixel size. */
export const ACTUAL = 1;
/** Two scales this close are the same scale: a pinch that ends here has ended at fit. */
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.002 * Math.max(a, b);

/** The limits around a fit the layout already chose. */
export function limits(fit: number): Limits {
  const look = ACTUAL > fit * 1.05 ? ACTUAL : fit * 2;
  return { fit, actual: ACTUAL, look, min: fit, max: Math.max(look * 2, ACTUAL) };
}

export const clampScale = (s: number, l: Limits): number => Math.min(l.max, Math.max(l.min, s));

/**
 * The picture kept inside the viewport where it fits, and pinned to the
 * edges where it overflows. Not centred: a zoom about a point keeps that
 * point where it is, and a picture snapped back to the middle would slide
 * out from under it.
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

/** Scale to `next`, keeping the picture point under `(px, py)` where it is. */
export function zoomTo(v: View, next: number, px: number, py: number, viewport: Size, natural: Size, l: Limits): View {
  const s = clampScale(next, l);
  const k = s / v.scale;
  return clampPan({ scale: s, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k }, viewport, natural);
}

export function panBy(v: View, dx: number, dy: number, viewport: Size, natural: Size): View {
  return clampPan({ scale: v.scale, tx: v.tx + dx, ty: v.ty + dy }, viewport, natural);
}

/** Whether the picture runs past the viewport on either axis, so a drag has somewhere to go. */
export function overflows(v: View, viewport: Size, natural: Size): boolean {
  return natural.w * v.scale > viewport.w + 0.5 || natural.h * v.scale > viewport.h + 0.5;
}

export const isFit = (scale: number, l: Limits): boolean => near(scale, l.fit);

/** Where a click goes: from fit to the look; from anywhere else back to fit. */
export const toggleTarget = (scale: number, l: Limits): number => (isFit(scale, l) ? l.look : l.fit);

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
