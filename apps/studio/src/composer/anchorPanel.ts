/**
 * Where a chip-anchored panel goes.
 *
 * Kept as arithmetic with no DOM in it, because the two things this has to get
 * right are both invisible until they are wrong: a panel that grows off the top
 * of the screen as its content grows, and a panel measured against the layout
 * viewport while a software keyboard is covering half of it.
 *
 * The insert menu uses `placeInsertMenu` for the same two problems. This
 * helper stays the chip-picker path: it anchors `top` and returns a
 * `maxHeight`, so growth is bounded by construction, and it takes the
 * viewport as an argument so the caller can hand it `visualViewport`.
 */

/** Wide enough for four cards of real thumbnail, narrow enough to stay a panel. */
export const PANEL_W = 440;
/** Taller than this stops being a quick pick and starts being a library page. */
export const PANEL_MAX_H = 460;
/**
 * A preview is one square picture and a two-line caption, so it is a fraction
 * of a picker: a glance at what a chip is holding, never a panel over the
 * composer. The face itself is 132px, and this is that plus the panel's inset
 * on both sides.
 */
export const PREVIEW_W = 156;
/** Chip to panel. */
const GAP = 8;
/** Anchor to preview card: room for the card's tail and a breath beside it. */
export const PREVIEW_GAP = 14;
/** How far in from a card's corner the tail may sit, so it never lands on the rounding. */
const TAIL_INSET = 20;
/** Never flush against a viewport edge. */
const MARGIN = 12;
/** Below this a scroller shows too little to choose from; flip instead. */
const MIN_H = 200;
/** Enough room above to be worth preferring the upward side. */
const COMFORTABLE = 240;

export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Placed {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  side: 'above' | 'below' | 'beside';
  /**
   * Opening above: the y the panel's bottom edge belongs at, a gap over the
   * anchor. Pin the panel by this (`bottom`), not by `top`: top is where a
   * panel of maxHeight would start, and a short panel placed by it floats
   * far above its chip with nothing in between. Below has no such problem.
   */
  bottomEdge?: number;
}

/** Where a card's tail sits: the edge that faces the anchor, and how far along it. */
export interface Tail {
  edge: 'top' | 'bottom' | 'left' | 'right';
  /** Along a top or bottom edge, from the card's left. */
  x: number;
  /** Along a left or right edge, from the card's top. */
  y: number;
}

/** A preview card's height: the square face plus its two-line caption and insets. */
export const PREVIEW_H = 204;

/**
 * Where a card goes beside a tile in a column: to the right of it, its top
 * level with the tile's top, the way a sidebar or a dock peeks. Opening
 * above or below would stack the card over the column's other tiles, which
 * is what the chip placement does and what reads wrong here. Pulled up when
 * the tile sits near the bottom so the card stays on screen, and put on the
 * left when there is no room on the right.
 */
export function placeBeside(a: AnchorRect, vp: Viewport, opts?: { width?: number }): Placed | null {
  if (a.bottom < 0 || a.top > vp.height) return null;
  const width = Math.min(opts?.width ?? PREVIEW_W, vp.width - MARGIN * 2);
  const fitsRight = a.right + PREVIEW_GAP + width + MARGIN <= vp.width;
  const left = fitsRight ? a.right + PREVIEW_GAP : Math.max(MARGIN, a.left - PREVIEW_GAP - width);
  const top = Math.max(MARGIN, Math.min(a.top, vp.height - MARGIN - PREVIEW_H));
  return { left, top, width, maxHeight: Math.max(MIN_H, vp.height - top - MARGIN), side: 'beside' };
}

/**
 * The tail a preview card wears, pointing at its anchor: on the edge that
 * faces the anchor, level with the anchor's middle, kept off the card's
 * rounded corners. Above or below, that is the bottom or top edge at the
 * anchor's centre; beside, the left or right edge at the anchor's middle.
 */
export function tailFor(a: AnchorRect, p: Placed): Tail {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, TAIL_INSET), Math.max(TAIL_INSET, max - TAIL_INSET));
  if (p.side === 'beside') {
    const edge = p.left >= a.right ? 'left' : 'right';
    return { edge, x: 0, y: clamp((a.top + a.bottom) / 2 - p.top, PREVIEW_H) };
  }
  return { edge: p.side === 'above' ? 'bottom' : 'top', x: clamp((a.left + a.right) / 2 - p.left, p.width), y: 0 };
}

/**
 * `null` when the anchor is no longer on screen: the brief is its own 30vh
 * scroller, so a chip can leave the viewport while its panel is open, and a
 * panel pointing at nothing should close rather than drift.
 */
export function placePanel(a: AnchorRect, vp: Viewport, opts?: { width?: number; gap?: number }): Placed | null {
  if (a.bottom < 0 || a.top > vp.height) return null;

  const width = Math.min(opts?.width ?? PANEL_W, vp.width - MARGIN * 2);
  const gap = opts?.gap ?? GAP;
  const roomAbove = a.top - gap - MARGIN;
  const roomBelow = vp.height - a.bottom - gap - MARGIN;

  // Prefer above. The composer sits at the bottom of the screen in all three
  // of its mounts, so opening upward is the only side that never covers the
  // brief you are editing.
  const side: 'above' | 'below' = roomAbove >= COMFORTABLE || roomAbove >= roomBelow ? 'above' : 'below';

  const room = side === 'above' ? roomAbove : roomBelow;
  const maxHeight = Math.max(MIN_H, Math.min(PANEL_MAX_H, room));
  const left = Math.min(Math.max(a.left, MARGIN), Math.max(MARGIN, vp.width - width - MARGIN));
  const top = side === 'above' ? Math.max(MARGIN, a.top - gap - maxHeight) : a.bottom + gap;
  return side === 'above'
    ? { left, top, width, maxHeight, side, bottomEdge: a.top - gap }
    : { left, top, width, maxHeight, side };
}

/**
 * The inline style for a placed panel. Above, the panel is pinned by its
 * bottom edge (fixed `bottom` counts from the layout viewport, and
 * getBoundingClientRect is in the same coordinates), so it hugs its chip
 * whatever its height; below, by its top.
 */
export function panelStyle(pos: Placed): {
  left: number;
  width: number;
  maxHeight: number;
  top?: number | 'auto';
  bottom?: number;
} {
  if (pos.side === 'above' && pos.bottomEdge !== undefined) {
    return {
      left: pos.left,
      width: pos.width,
      maxHeight: pos.maxHeight,
      top: 'auto',
      bottom: window.innerHeight - pos.bottomEdge,
    };
  }
  return { left: pos.left, width: pos.width, maxHeight: pos.maxHeight, top: pos.top };
}
