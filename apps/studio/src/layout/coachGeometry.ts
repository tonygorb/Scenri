import type { Side } from '../guidedTasks.js';

/**
 * The coachmark's geometry, kept apart from the DOM so every edge case is a plain
 * number test: what part of a target can be seen, what the card is placed
 * against, and the veil's window cut around the step's surfaces.
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

/**
 * The ring follows the asked control's own corners. A tight wrap of one
 * control uses that control's radius. Several chips in a group keep the
 * block radius: following one chip's pill merged them into a third control.
 * A taller block that merely holds chips does the same.
 */
export function ringRadius(
  own: number,
  inner = 0,
  offset = 4,
  block = 14,
  ownHeight = 0,
  innerHeight = 0,
  inners = 0,
): number {
  if (own >= 4) return own + offset;
  const wrap = innerHeight === 0 || ownHeight === 0 || ownHeight <= innerHeight + 16;
  if (inner >= 4 && wrap && inners <= 1) return inner + offset;
  return block;
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

const vertical = (side: Side) => side === 'top' || side === 'bottom';

/**
 * What the card is placed against. Across the side it takes the target, so
 * the card and its pointer centre on the control; along it the whole region,
 * so the card clears the composer rather than landing on it.
 */
export function referenceRect(target: Box, region: Box | null, side: Side): Box {
  if (!region) return target;
  return vertical(side)
    ? { left: target.left, right: target.right, top: region.top, bottom: region.bottom }
    : { left: region.left, right: region.right, top: target.top, bottom: target.bottom };
}

export const opposite = (side: Side): Side =>
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

/** A window in the curtain: a live surface or a control, with the corner radius it really has. */
export interface Window extends Box {
  radius: number;
}

/**
 * The curtain's windows, as one mask the size of the screen: the whole screen
 * shows the veil, every window is cut from it with its own radius, and windows
 * that touch or overlap simply join (a mask of shapes unions them, where layered
 * masks excluding each other would veil an overlap twice). Only the shapes live
 * in the picture, so a scrolled window rewrites the string and nothing else.
 */
export function windowsMask(windows: readonly Window[], vw: number, vh: number): string {
  const w = r1(vw);
  const h = r1(vh);
  const holes = windows
    .map((b) => {
      const ww = Math.max(0, r1(width(b)));
      const hh = Math.max(0, r1(height(b)));
      const k = r1(Math.max(0, Math.min(b.radius, ww / 2, hh / 2)));
      return `<rect x='${r1(b.left)}' y='${r1(b.top)}' width='${ww}' height='${hh}' rx='${k}' fill='black'/>`;
    })
    .join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><defs><mask id='m' maskUnits='userSpaceOnUse' x='0' y='0' width='${w}' height='${h}'><rect width='${w}' height='${h}' fill='white'/>${holes}</mask></defs><rect width='${w}' height='${h}' fill='black' mask='url(#m)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * The quiet edge around the windows: each window's outline, drawn only where
 * it falls on the curtain. Where two windows join, the part of one outline
 * inside the other is masked away, so a joined window keeps one clean edge.
 */
export function windowsRim(windows: readonly Window[], vw: number, vh: number, stroke: string): string {
  const w = r1(vw);
  const h = r1(vh);
  const rects = windows.map((b) => {
    const ww = Math.max(0, r1(width(b)));
    const hh = Math.max(0, r1(height(b)));
    const k = r1(Math.max(0, Math.min(b.radius, ww / 2, hh / 2)));
    return { x: r1(b.left), y: r1(b.top), ww, hh, k };
  });
  const holes = rects.map(
    (r) => `<rect x='${r.x}' y='${r.y}' width='${r.ww}' height='${r.hh}' rx='${r.k}' fill='black'/>`,
  );
  const lines = rects.map(
    (r) =>
      `<rect x='${r.x}' y='${r.y}' width='${r.ww}' height='${r.hh}' rx='${r.k}' fill='none' stroke='${stroke}' stroke-width='2'/>`,
  );
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><defs><mask id='o' maskUnits='userSpaceOnUse' x='0' y='0' width='${w}' height='${h}'><rect width='${w}' height='${h}' fill='white'/>${holes.join('')}</mask></defs><g mask='url(#o)'>${lines.join('')}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * Which side of an open picker a card of `need` pixels fits beside, right
 * first: the side the eye reads on to. Null when neither has room, and the
 * words go inside the picker instead of hiding.
 */
export function sideWithRoom(picker: Box, vw: number, need: number): 'right' | 'left' | null {
  if (vw - picker.right >= need) return 'right';
  if (picker.left >= need) return 'left';
  return null;
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
