import type { TourSide } from '../tours.js';

/**
 * The tour's geometry, kept apart from the DOM so every edge case is a plain
 * number test: what part of a target can be seen, what the card is placed
 * against, and the veil's window cut around the stop's surface.
 */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const boxOf = (r: { left: number; top: number; right: number; bottom: number }): Box => ({
  left: r.left,
  top: r.top,
  right: r.right,
  bottom: r.bottom,
});

export const width = (b: Box) => b.right - b.left;
export const height = (b: Box) => b.bottom - b.top;

export function union(a: Box, b: Box): Box {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

export function pad(b: Box, n: number): Box {
  return { left: b.left - n, top: b.top - n, right: b.right + n, bottom: b.bottom + n };
}

/** Whether two boxes share any area. Touching edges do not count. */
export function intersects(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** The part of `b` inside every clip (the viewport, the pane it scrolls in), or null when none of it shows. */
export function visibleRect(b: Box, clips: readonly Box[]): Box | null {
  let v = b;
  for (const c of clips) {
    v = {
      left: Math.max(v.left, c.left),
      top: Math.max(v.top, c.top),
      right: Math.min(v.right, c.right),
      bottom: Math.min(v.bottom, c.bottom),
    };
  }
  return width(v) > 0 && height(v) > 0 ? v : null;
}

/**
 * A window stops where fixed chrome floats over its target (the composer dock
 * over the example wall, a bar over a scrolled pane): the window shows only
 * what can actually be pressed there. Chrome in the lower half of the window
 * lowers its bottom; chrome in the upper half raises its top; chrome across
 * the middle keeps what is above it.
 */
export function trimBy(b: Box, occluders: readonly Box[]): Box | null {
  let { top, bottom } = b;
  const mid = (b.top + b.bottom) / 2;
  for (const c of occluders) {
    if (!intersects(c, b)) continue;
    if (c.bottom <= mid) top = Math.max(top, c.bottom);
    else bottom = Math.min(bottom, c.top);
  }
  return bottom > top ? { ...b, top, bottom } : null;
}

const vertical = (side: TourSide) => side === 'top' || side === 'bottom';

/**
 * What the card is placed against. Across the side it takes the target, so
 * the card and its pointer centre on the control; along it the whole region,
 * so the card clears the composer rather than landing on it.
 */
export function referenceRect(target: Box, region: Box | null, side: TourSide): Box {
  if (!region) return target;
  return vertical(side)
    ? { left: target.left, right: target.right, top: region.top, bottom: region.bottom }
    : { left: region.left, right: region.right, top: target.top, bottom: target.bottom };
}

export const opposite = (side: TourSide): TourSide =>
  side === 'top' ? 'bottom' : side === 'bottom' ? 'top' : side === 'left' ? 'right' : 'left';

const r1 = (n: number) => Math.round(n * 2) / 2;

/**
 * The veil's window, as a mask: the whole veil, less one rounded rectangle.
 * A mask is applied after the blur, so the window is neither dimmed nor
 * softened; a `clip-path` hole was measured still blurring across the window in
 * Chrome. Presses are not the mask's business (a mask never changes
 * hit-testing): four clear panels around the window take them instead.
 * Only the rectangle's size is baked into the image, so moving the window, as
 * a pane scrolls, rewrites one position rather than the picture.
 */
export function windowMask(hole: Box, radius: number): { image: string; size: string; position: string } {
  const w = Math.max(0, r1(width(hole)));
  const h = Math.max(0, r1(height(hole)));
  const k = r1(Math.max(0, Math.min(radius, w / 2, h / 2)));
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='${w}' height='${h}' rx='${k}'/></svg>`;
  return {
    image: `linear-gradient(#000 0 0), url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    size: `100% 100%, ${w}px ${h}px`,
    position: `0 0, ${r1(hole.left)}px ${r1(hole.top)}px`,
  };
}

/** Four panels around a window: the clear ones that take presses, and the plain veil where a mask cannot cut one. */
export function panels(hole: Box, vw: number, vh: number): Box[] {
  const h = {
    left: Math.max(0, hole.left),
    top: Math.max(0, hole.top),
    right: Math.min(vw, hole.right),
    bottom: Math.min(vh, hole.bottom),
  };
  return [
    { left: 0, top: 0, right: vw, bottom: h.top },
    { left: 0, top: h.bottom, right: vw, bottom: vh },
    { left: 0, top: h.top, right: h.left, bottom: h.bottom },
    { left: h.right, top: h.top, right: vw, bottom: h.bottom },
  ].filter((p) => width(p) > 0 && height(p) > 0);
}
