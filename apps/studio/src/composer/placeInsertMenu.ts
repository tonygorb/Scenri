import type { AnchorRect, Viewport } from './anchorPanel.js';

/** Wide enough for a name + hint, narrow enough to stay a typing surface. */
export const INSERT_MENU_W = 320;
/** Taller than this stops being a shortlist. */
export const INSERT_MENU_MAX_H = 320;
/** Phone dock: enough rows to choose, never the whole screen. */
export const INSERT_MENU_PHONE_MAX_H = 280;

const GAP = 8;
const MARGIN = 12;
const PHONE_MARGIN = 8;
/** Below this, flip or dock rather than draw an unusable sliver. */
const MIN_CARET_H = 80;
/** Enough room above the caret to prefer that side. */
const COMFORTABLE = 120;

export interface InsertPlaced {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  side: 'above' | 'below';
  shell: 'caret' | 'dock';
}

/** Wider than a character: the empty-line lie, the whole block as a caret. */
const LINE_BOX = 48;

/**
 * A collapsed range at 0,0 is the contenteditable lie: the caret is in the
 * line, the rect is not. Treating that as an anchor pins the menu to the
 * viewport origin.
 *
 * A rect as wide as the brief is the other lie. An empty line reports the
 * whole block; using that as a caret parks a 320px panel on the composer
 * instead of on the `#`.
 */
function caretReliable(caret: AnchorRect | null, vp: Viewport): boolean {
  if (!caret) return false;
  if (caret.top === 0 && caret.left === 0 && caret.right === 0 && caret.bottom === 0) return false;
  if (caret.bottom < 0 || caret.top > vp.height) return false;
  if (caret.right - caret.left > LINE_BOX) return false;
  return true;
}

/** Hang off the start of a line box when the caret itself is a lie. */
function lineStart(box: AnchorRect): AnchorRect {
  return { top: box.top, bottom: Math.min(box.bottom, box.top + 22), left: box.left, right: box.left + 2 };
}

function clampLeft(left: number, width: number, vp: Viewport, margin: number): number {
  return Math.min(Math.max(left, margin), Math.max(margin, vp.width - width - margin));
}

function dockAboveComposer(composer: AnchorRect, vp: Viewport, phone: boolean): InsertPlaced {
  const margin = phone ? PHONE_MARGIN : MARGIN;
  const width = phone
    ? Math.max(0, composer.right - composer.left)
    : Math.min(INSERT_MENU_W, vp.width - margin * 2);
  const left = phone ? composer.left : clampLeft(composer.left, width, vp, margin);
  const cap = phone ? Math.min(INSERT_MENU_PHONE_MAX_H, Math.floor(vp.height * 0.4)) : INSERT_MENU_MAX_H;
  const room = composer.top - GAP - margin;
  const maxHeight = Math.max(0, Math.min(cap, room));
  const top = Math.max(margin, composer.top - GAP - maxHeight);
  return { left, top, width, maxHeight, side: 'above', shell: 'dock' };
}

function placeAtCaret(caret: AnchorRect, composer: AnchorRect, vp: Viewport): InsertPlaced {
  const width = Math.min(INSERT_MENU_W, vp.width - MARGIN * 2);
  const left = clampLeft(caret.left, width, vp, MARGIN);
  const roomAbove = caret.top - GAP - MARGIN;
  const roomBelow = vp.height - caret.bottom - GAP - MARGIN;
  const side: 'above' | 'below' = roomAbove >= COMFORTABLE || roomAbove >= roomBelow ? 'above' : 'below';
  const room = side === 'above' ? roomAbove : roomBelow;
  const maxHeight = Math.min(INSERT_MENU_MAX_H, Math.max(MIN_CARET_H, room));

  if (side === 'above') {
    const top = Math.max(MARGIN, caret.top - GAP - Math.min(INSERT_MENU_MAX_H, roomAbove));
    const height = Math.min(INSERT_MENU_MAX_H, caret.top - GAP - top);
    if (height < MIN_CARET_H) return dockAboveComposer(composer, vp, false);
    return { left, top, width, maxHeight: height, side, shell: 'caret' };
  }

  const top = caret.bottom + GAP;
  if (top + Math.min(maxHeight, roomBelow) > vp.height - MARGIN) return dockAboveComposer(composer, vp, false);
  return { left, top, width, maxHeight: Math.min(INSERT_MENU_MAX_H, roomBelow), side, shell: 'caret' };
}

/**
 * Where the insert menu goes.
 *
 * Desktop prefers the caret, then the composer edge when that rect is a lie
 * or the box would clip. Phone always docks to the composer — a software
 * keyboard makes caret-following the thing that opens under the keys.
 *
 * `vp` is the visual viewport. Callers that pass `window.innerHeight` on iOS
 * recreate the bug this exists to avoid.
 */
export function placeInsertMenu(
  caret: AnchorRect | null,
  composer: AnchorRect,
  vp: Viewport,
  o: { phone?: boolean; line?: AnchorRect | null } = {},
): InsertPlaced | null {
  if (o.phone) return dockAboveComposer(composer, vp, true);
  const line = o.line ?? composer;
  if (caretReliable(caret, vp) && caret) return placeAtCaret(caret, composer, vp);
  // Empty `#` / `@` / `/`: hang off the text start, not the prompt card.
  // Docking to the card is what put a slab over the middle of the composer.
  const box = caret && caret.right - caret.left > LINE_BOX ? caret : line;
  return placeAtCaret(lineStart(box), composer, vp);
}
