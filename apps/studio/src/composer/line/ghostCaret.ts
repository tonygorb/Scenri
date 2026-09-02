import { isChip } from './invariants.js';
import { isOwnedSpace } from './keys.js';

// ---------------------------------------------------------------- the caret between two chips

/**
 * A caret drawn in the middle of the gap between two chips.
 *
 * The gap is one space character, so the browser's caret can only sit at one
 * of its two edges, flush against a pill. The keys already treat that gap as a
 * single stop; this makes it look like one. While the caret sits anywhere in
 * a chip's space between two chips, the browser's caret is hidden and a bar
 * is drawn at the midpoint instead, the way the drop indicator already marks
 * a gap during a drag. Everywhere else the browser's caret is untouched.
 *
 * Fine pointers only. A touch caret comes with its own handle and loupe, and
 * hiding it would take those away.
 */
export function attachGhostCaret(root: HTMLElement | null): () => void {
  if (!root || typeof window === 'undefined') return () => {};
  if (!window.matchMedia('(pointer: fine)').matches) return () => {};

  let ghost: HTMLDivElement | null = null;
  const hide = () => {
    root.style.caretColor = '';
    if (ghost) ghost.hidden = true;
  };
  const place = () => {
    const gap = gapAtCaret(root);
    if (!gap || document.activeElement !== root) return hide();
    if (!ghost) {
      ghost = document.createElement('div');
      ghost.className = 'sc-caret-ghost';
      document.body.appendChild(ghost);
    }
    const x = (gap.before.right + gap.after.left) / 2;
    const top = Math.min(gap.before.top, gap.after.top);
    const bottom = Math.max(gap.before.bottom, gap.after.bottom);
    ghost.style.transform = `translate3d(${x - 0.5}px, ${top + 2}px, 0)`;
    ghost.style.height = `${bottom - top - 4}px`;
    // a keystroke resets a native caret's blink; so does this
    ghost.style.animation = 'none';
    void ghost.offsetWidth;
    ghost.style.animation = '';
    ghost.hidden = false;
    root.style.caretColor = 'transparent';
  };

  document.addEventListener('selectionchange', place);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  root.addEventListener('focusout', hide);
  root.addEventListener('focusin', place);
  return () => {
    document.removeEventListener('selectionchange', place);
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
    root.removeEventListener('focusout', hide);
    root.removeEventListener('focusin', place);
    ghost?.remove();
    root.style.caretColor = '';
  };
}

/**
 * The two chips whose gap the caret sits in, or null when it sits anywhere
 * else: in prose, in a chip's space at the end of the line, or as a selection.
 */
export function gapAtCaret(root: HTMLElement): { before: DOMRect; after: DOMRect } | null {
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.getRangeAt(0).collapsed) return null;
  const node = sel.getRangeAt(0).startContainer;
  if (node.parentNode !== root || !isOwnedSpace(node as ChildNode) || !isChip(node.nextSibling)) return null;
  const before = node.previousSibling as HTMLElement;
  const after = node.nextSibling as HTMLElement;
  const b = before.getBoundingClientRect();
  const a = after.getBoundingClientRect();
  // the two chips must share a row, or there is no gap to sit in
  if (b.bottom <= a.top || a.bottom <= b.top) return null;
  return { before: b, after: a };
}
