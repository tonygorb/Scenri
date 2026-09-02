import { placeCaret } from './caret.js';
import { isChip } from './invariants.js';

// ---------------------------------------------------------------- a chip and its space, as one

/**
 * A chip and the space after it are one thing to the keyboard.
 *
 * Between two chips, and after the last one, the line keeps exactly one space
 * so there is somewhere for a caret to be. That space is the chip's, not the
 * sentence's: nothing typed into it is a word, and deleting it only puts two
 * chips shoulder to shoulder until the line puts it back. Left to the browser
 * it was still a character, so crossing a chip took two presses and removing
 * one took two as well, with the chips touching in between. These rules make
 * the two one unit: one press crosses a chip, one press removes it, and the
 * far edge of its space is the only place the caret stops in that gap.
 *
 * Prose beside a chip is untouched. Its spaces are the user's, and the keys
 * step through them a character at a time, as they do in any sentence.
 */

/** A chip's own space: spaces only, a chip before it, and a chip or nothing after. */
export const isOwnedSpace = (n: ChildNode | null): n is Text =>
  !!n &&
  n.nodeType === Node.TEXT_NODE &&
  / +/.test(n.textContent ?? '') &&
  /^ *$/.test(n.textContent ?? '') &&
  isChip(n.previousSibling) &&
  (isChip(n.nextSibling) || !n.nextSibling);

/** The collapsed caret, when it sits in one of the line's own text nodes. */
function caretIn(root: HTMLElement | null): { text: Text; at: number } | null {
  if (!root) return null;
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.getRangeAt(0).collapsed) return null;
  const r = sel.getRangeAt(0);
  const node = r.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || node.parentNode !== root) return null;
  return { text: node as Text, at: r.startOffset };
}

/**
 * Step over a chip in one press, its space included.
 *
 * True when the caret was moved and the browser's own step must not happen.
 * False leaves the key to the browser: prose is stepped through a character
 * at a time, and crossing a chip into prose lands where the browser lands.
 */
export function stepAcrossChip(root: HTMLElement | null, dir: 'left' | 'right'): boolean {
  const c = caretIn(root);
  if (!c || !root) return false;
  const { text, at } = c;
  if (dir === 'right') {
    // Right before a chip. The browser would cross it and stop at the near
    // edge of its space; the far edge is the stop, so the space goes with it.
    if (at !== text.length || !isChip(text.nextSibling)) return false;
    const after = text.nextSibling?.nextSibling ?? null;
    if (!isOwnedSpace(after)) return false;
    placeCaret(root, after, 1);
    return true;
  }
  // At the far edge of a chip's space: a step back crosses the chip too.
  if (at !== text.length || !isOwnedSpace(text)) return false;
  const before = text.previousSibling?.previousSibling ?? null;
  if (before?.nodeType !== Node.TEXT_NODE) return false;
  placeCaret(root, before as Text, (before as Text).length);
  return true;
}

/**
 * The chip a Backspace or Delete at a chip's space is really aimed at.
 *
 * Backspace from the far edge of a chip's space takes the chip before it;
 * Delete from the near edge takes the chip after it. Anywhere else the key is
 * the browser's, which already deletes a chip the caret is flush against.
 */
export function chipToDelete(root: HTMLElement | null, key: 'Backspace' | 'Delete'): HTMLElement | null {
  const c = caretIn(root);
  if (!c) return null;
  const { text, at } = c;
  if (!isOwnedSpace(text)) return null;
  if (key === 'Backspace' && at === text.length) return text.previousSibling as HTMLElement;
  if (key === 'Delete' && at === 0 && isChip(text.nextSibling)) return text.nextSibling as HTMLElement;
  return null;
}
