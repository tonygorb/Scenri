import { isGuard, placeCaret } from './caret.js';
import { caretIn, isChip } from './invariants.js';

// ---------------------------------------------------------------- a chip and its guard, as one

/**
 * A chip is an inline atom; the text beside it is either the user's or a
 * guard, one zero-width character that hosts the caret where the user has
 * typed nothing. The browsers step and delete around such a thing as if it
 * were a letter, so these rules make the atom one unit to the keyboard: one
 * press crosses it, the key that faces it removes it. In prose the keys are
 * the browser's.
 */

/**
 * Step over a chip in one press.
 *
 * True when the caret was moved and the browser's own step must not happen.
 * At the edge of the text beside a chip, or anywhere in its guard, the step
 * crosses the chip and lands in the text on its other side: past that text's
 * guard, or at the near edge of its prose.
 */
export function stepAcrossChip(root: HTMLElement | null, dir: 'left' | 'right'): boolean {
  const c = caretIn(root);
  if (!c || !root) return false;
  const { text, at } = c;
  const guard = isGuard(text);
  if (dir === 'right') {
    if (!isChip(text.nextSibling) || (!guard && at !== text.length)) return false;
    const after = text.nextSibling?.nextSibling;
    if (after?.nodeType !== Node.TEXT_NODE) return false;
    placeCaret(root, after as Text, isGuard(after) ? 1 : 0);
    return true;
  }
  if (!isChip(text.previousSibling) || (!guard && at !== 0)) return false;
  const before = text.previousSibling?.previousSibling;
  if (before?.nodeType !== Node.TEXT_NODE) return false;
  placeCaret(root, before as Text, isGuard(before) ? 1 : (before as Text).length);
  return true;
}

/**
 * The chip a Backspace or Delete is aimed at.
 *
 * Backspace flush after a chip, or anywhere in the guard after it, takes the
 * chip; Delete flush before one, or in the guard before it, likewise. Left to
 * the browser the press took the guard, the line put it straight back, and
 * nothing seemed to happen. Anywhere else the key is the browser's.
 */
export function chipToDelete(root: HTMLElement | null, key: 'Backspace' | 'Delete'): HTMLElement | null {
  const c = caretIn(root);
  if (!c) return null;
  const { text, at } = c;
  const guard = isGuard(text);
  if (key === 'Backspace') {
    return isChip(text.previousSibling) && (guard || at === 0) ? (text.previousSibling as HTMLElement) : null;
  }
  return isChip(text.nextSibling) && (guard || at === text.length) ? (text.nextSibling as HTMLElement) : null;
}

/**
 * A press with nothing on its side of the caret: Backspace in the guard before
 * a chip that starts the line, Delete in the guard after one that ends it.
 * Left to the browser it took the guard, or the line; swallowed.
 */
export function deletionAtLineEdge(root: HTMLElement | null, key: 'Backspace' | 'Delete'): boolean {
  const c = caretIn(root);
  if (!c || !isGuard(c.text)) return false;
  return key === 'Backspace' ? !c.text.previousSibling : !c.text.nextSibling;
}
