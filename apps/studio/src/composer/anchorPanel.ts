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
  const fitsRight = a.right + GAP + width + MARGIN <= vp.width;
  const left = fitsRight ? a.right + GAP : Math.max(MARGIN, a.left - GAP - width);
  const top = Math.max(MARGIN, Math.min(a.top, vp.height - MARGIN - PREVIEW_H));
  return { left, top, width, maxHeight: Math.max(MIN_H, vp.height - top - MARGIN), side: 'beside' };
}

/**
 * `null` when the anchor is no longer on screen: the brief is its own 30vh
 * scroller, so a chip can leave the viewport while its panel is open, and a
 * panel pointing at nothing should close rather than drift.
 */
export function placePanel(a: AnchorRect, vp: Viewport, opts?: { width?: number }): Placed | null {
  if (a.bottom < 0 || a.top > vp.height) return null;

  const width = Math.min(opts?.width ?? PANEL_W, vp.width - MARGIN * 2);
  const roomAbove = a.top - GAP - MARGIN;
  const roomBelow = vp.height - a.bottom - GAP - MARGIN;

  // Prefer above. The composer sits at the bottom of the screen in all three
  // of its mounts, so opening upward is the only side that never covers the
  // brief you are editing.
  const side: 'above' | 'below' = roomAbove >= COMFORTABLE || roomAbove >= roomBelow ? 'above' : 'below';

  const room = side === 'above' ? roomAbove : roomBelow;
  const maxHeight = Math.max(MIN_H, Math.min(PANEL_MAX_H, room));
  const left = Math.min(Math.max(a.left, MARGIN), Math.max(MARGIN, vp.width - width - MARGIN));
  const top = side === 'above' ? Math.max(MARGIN, a.top - GAP - maxHeight) : a.bottom + GAP;
  return { left, top, width, maxHeight, side };
}
