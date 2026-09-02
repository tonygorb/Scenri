import { CHIP_SELECTOR, decode, identityKeyOf } from './tokens.js';
import { placeCaret } from './caret.js';

// ---------------------------------------------------------------- slash query

/**
 * Text from the start of the run up to the caret, for filtering the menu.
 * A chip ends the query; the browser can split one run of typing across
 * several text nodes, so this walks back over them.
 */
/** The chip that IS this identity, if the line holds one: the twin guard and the rail's untick share it. */
export function chipForIdentity(root: HTMLElement, key: string): HTMLElement | null {
  for (const c of Array.from(root.querySelectorAll<HTMLElement>(CHIP_SELECTOR))) {
    const held = decode(c.dataset.tok ?? '');
    if (held && identityKeyOf(held) === key) return c;
  }
  return null;
}

export function textBeforeCaret(root: HTMLElement | null): string {
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!root || !sel || sel.rangeCount === 0) return '';
  const r = sel.getRangeAt(0);
  if (r.startContainer.nodeType !== Node.TEXT_NODE || !root.contains(r.startContainer)) return '';
  let out = (r.startContainer.textContent ?? '').slice(0, r.startOffset);
  for (let n = r.startContainer.previousSibling; n && n.nodeType === Node.TEXT_NODE; n = n.previousSibling) {
    out = (n.textContent ?? '') + out;
  }
  return out;
}

/** Rect of the caret, so the slash menu opens where the user is typing. */
export function caretRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0).cloneRange();
  const rect = r.getBoundingClientRect();
  if (rect.width || rect.height) return rect;
  const probe = document.createElement('span');
  probe.textContent = '​';
  r.insertNode(probe);
  const out = probe.getBoundingClientRect();
  const parent = probe.parentNode;
  probe.remove();
  parent?.normalize();
  return out;
}

/**
 * Put the caret immediately before or after a chip.
 *
 * A chip is an atom: the caret must never end up inside it, where there is
 * nothing to type into and arrow keys have to walk back out. user-select:none
 * keeps the browser from putting it there, but then a click on the chip has
 * nowhere to go and Chromium falls back to the start of the line, so the side
 * the user clicked has to be honoured explicitly. This is safe to do during a
 * click: the line never loses focus, which is the case Chromium honours.
 */
export function caretBeside(root: HTMLElement | null, chip: Element | null, side: 'before' | 'after'): void {
  if (!root || !chip) return;
  if (side === 'after') {
    const next = chip.nextSibling;
    if (next?.nodeType === Node.TEXT_NODE) {
      const t = next as Text;
      // past the single space that follows a chip, so the caret reads as
      // sitting after the pill rather than wedged against it
      placeCaret(root, t, Math.min(1, t.length));
      return;
    }
    const t = document.createTextNode(' ');
    chip.parentNode?.insertBefore(t, chip.nextSibling);
    placeCaret(root, t, t.length);
    return;
  }
  const prev = chip.previousSibling;
  if (prev?.nodeType === Node.TEXT_NODE) {
    const t = prev as Text;
    placeCaret(root, t, t.length);
    return;
  }
  const t = document.createTextNode('');
  chip.parentNode?.insertBefore(t, chip);
  placeCaret(root, t, 0);
}

/** How far either side of a chip still counts as "I meant this chip". */
const CHIP_GAP = 9;

/** One rect per rendered row of the line, in order. */
function rowRects(root: HTMLElement): DOMRect[] {
  if (!root.firstChild) return [];
  const r = document.createRange();
  r.selectNodeContents(root);
  return Array.from(r.getClientRects()).filter((b) => b.height > 0);
}

/** The row a click belongs to, even when it landed in the padding. */
function nearestRow(rows: DOMRect[], y: number): DOMRect | null {
  let best: DOMRect | null = null;
  let bestGap = Infinity;
  for (const row of rows) {
    const gap = y < row.top ? row.top - y : y > row.bottom ? y - row.bottom : 0;
    if (gap < bestGap) {
      bestGap = gap;
      best = row;
    }
  }
  return best;
}

/**
 * Place the caret for a click anywhere in the line.
 *
 * The browser cannot be trusted with this. Two failures, both measured:
 * a click in the few pixels between a chip and the text after it resolves to
 * the position BEFORE the chip, tens of pixels away on the other side of it;
 * and a click in the line's padding, above or below the row, resolves to the
 * very start of the sentence instead of to the nearest position on that row.
 * Together they meant a click next to a chip threw the caret back to the front
 * of the brief.
 *
 * So: the click is pulled onto the nearest row, and if it fell on or beside a
 * chip, which half of that chip decides. Anything else is handed back to the
 * browser at the corrected point, where it behaves.
 *
 * Returns true when this click was ours to place.
 */
export function caretFromPoint(root: HTMLElement | null, x: number, y: number): boolean {
  if (!root) return false;
  const rows = rowRects(root);
  const row = nearestRow(rows, y);
  if (!row) return false;
  const cy = row.top + row.height / 2;

  for (const chip of Array.from(root.querySelectorAll<HTMLElement>(CHIP_SELECTOR))) {
    const r = chip.getBoundingClientRect();
    if (r.bottom < row.top || r.top > row.bottom) continue; // a chip on another row
    if (x < r.left - CHIP_GAP || x > r.right + CHIP_GAP) continue;
    caretBeside(root, chip, x < r.left + r.width / 2 ? 'before' : 'after');
    return true;
  }

  // Inside the row the browser's own answer is right, and on a phone it is
  // more than right: a touch caret snaps to the end of the tapped word, the
  // way every field on the platform does, and re-placing it at the finger's
  // exact x moved it mid-word to wherever the finger happened to be. Only a
  // click in the padding, above or below the row, is asked again from inside.
  if (y >= row.top && y <= row.bottom) return false;
  const at = caretRangeFromPoint(x, cy);
  if (!at || !root.contains(at.node)) return false;
  if (at.node.nodeType !== Node.TEXT_NODE) return false;
  placeCaret(root, at.node as Text, at.offset);
  return true;
}

/**
 * Resolve a pointer position to a place in the line, without moving anything.
 *
 * The same row-pull and chip-band rules `caretFromPoint` applies before it
 * places the caret, handed back as data: the drag's drop indicator needs to
 * know where a drop WOULD land on every pointermove, and moving the live
 * caret that often would fight the browser. A point on or beside a chip
 * resolves to the chip's own edge; anything else is asked of the browser at
 * the row-corrected point.
 */
export function pointToLinePosition(
  root: HTMLElement | null,
  x: number,
  y: number,
): { node: Node; offset: number } | { beside: HTMLElement; side: 'before' | 'after' } | null {
  if (!root) return null;
  const row = nearestRow(rowRects(root), y);
  if (!row) return null;
  const cy = row.top + row.height / 2;
  for (const chip of Array.from(root.querySelectorAll<HTMLElement>(CHIP_SELECTOR))) {
    const r = chip.getBoundingClientRect();
    if (r.bottom < row.top || r.top > row.bottom) continue;
    if (x < r.left - CHIP_GAP || x > r.right + CHIP_GAP) continue;
    return { beside: chip, side: x < r.left + r.width / 2 ? 'before' : 'after' };
  }
  const at = caretRangeFromPoint(x, cy);
  if (!at || !root.contains(at.node)) return null;
  return { node: at.node, offset: at.offset };
}

/** caretRangeFromPoint is Chromium and WebKit; Firefox spells it differently. */
function caretRangeFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const r = doc.caretRangeFromPoint?.(x, y);
  if (r) return { node: r.startContainer, offset: r.startOffset };
  const p = doc.caretPositionFromPoint?.(x, y);
  return p ? { node: p.offsetNode, offset: p.offset } : null;
}
