import { isChip } from './invariants.js';

// ---------------------------------------------------------------- deleting an atom

/**
 * The chip a Backspace or Delete is aimed at.
 *
 * A chip is an inline atom, and the browsers do not agree on deleting one.
 * Measured: Chromium removes it from a caret in the text flush beside it and
 * does nothing from a caret on the line between two chips; WebKit does nothing
 * from the text and removes BOTH chips from the line. So the line owns the
 * deletion, the way every atom editor does: a collapsed caret immediately
 * beside a chip on the side the key faces, anchored in text at its edge or on
 * the line at the chip's index, takes that chip and nothing else. Anywhere
 * else the key is the browser's.
 */
export function chipToDelete(root: HTMLElement | null, key: 'Backspace' | 'Delete'): HTMLElement | null {
  if (!root) return null;
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.getRangeAt(0).collapsed) return null;
  const r = sel.getRangeAt(0);
  const node = r.startContainer;
  const back = key === 'Backspace';
  if (node === root) {
    const n = back ? root.childNodes[r.startOffset - 1] : root.childNodes[r.startOffset];
    return isChip(n ?? null) ? (n as HTMLElement) : null;
  }
  if (node.nodeType !== Node.TEXT_NODE || node.parentNode !== root) return null;
  const text = node as Text;
  if (back) return r.startOffset === 0 && isChip(text.previousSibling) ? (text.previousSibling as HTMLElement) : null;
  return r.startOffset === text.length && isChip(text.nextSibling) ? (text.nextSibling as HTMLElement) : null;
}

/**
 * A Backspace or Delete with nothing on its side of the caret.
 *
 * At the very start or the very end of the line, anchored on the line itself
 * because a chip is what stands there, a deletion has nothing to take. Left to
 * the browser it took the line: Chromium and WebKit both treat the edge of an
 * editing host beside a non-editable atom as something to merge or clear. So
 * the press is swallowed.
 */
export function deletionAtLineEdge(root: HTMLElement | null, key: 'Backspace' | 'Delete'): boolean {
  if (!root) return false;
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.getRangeAt(0).collapsed) return false;
  const r = sel.getRangeAt(0);
  if (r.startContainer !== root) return false;
  return key === 'Backspace' ? r.startOffset === 0 : r.startOffset === root.childNodes.length;
}
