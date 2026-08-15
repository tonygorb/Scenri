/**
 * Where a chip-anchored panel goes.
 *
 * Kept as arithmetic with no DOM in it, because the two things this has to get
 * right are both invisible until they are wrong: a panel that grows off the top
 * of the screen as its content grows, and a panel measured against the layout
 * viewport while a software keyboard is covering half of it.
 *
 * The command menu (TokenMenu) does neither. It pins `bottom` to the anchor's
 * top and lets the box grow upward, so a taller list walks off the screen; and
 * it clamps against `window.innerHeight`, which on iOS does not shrink for the
 * keyboard. This anchors `top` and returns a `maxHeight` instead, so growth is
 * bounded by construction, and it takes the viewport as an argument so the
 * caller can hand it `visualViewport`.
 */

/** Wide enough for four cards of real thumbnail, narrow enough to stay a panel. */
export const PANEL_W = 440;
/** Taller than this stops being a quick pick and starts being a library page. */
export const PANEL_MAX_H = 460;
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
  side: 'above' | 'below';
}

/**
 * `null` when the anchor is no longer on screen: the brief is its own 30vh
 * scroller, so a chip can leave the viewport while its panel is open, and a
 * panel pointing at nothing should close rather than drift.
 */
export function placePanel(a: AnchorRect, vp: Viewport): Placed | null {
  if (a.bottom < 0 || a.top > vp.height) return null;

  const width = Math.min(PANEL_W, vp.width - MARGIN * 2);
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
