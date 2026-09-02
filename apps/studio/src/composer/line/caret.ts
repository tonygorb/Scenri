// ---------------------------------------------------------------- caret, as an offset

/**
 * The guard character: a zero-width text node beside a chip, so a caret always
 * has text to sit in (a phone shows no caret anywhere else), while the chip's
 * margin is the visible gap. It is never part of the sentence: the readers
 * strip it, the unit maths does not count it, and a keystroke into it leaves
 * only what was typed.
 */
export const GUARD = '﻿';
export const GUARD_RE = /﻿/g;

/** A text node that is nothing but a guard. */
export const isGuard = (n: Node | null | undefined): boolean =>
  !!n && n.nodeType === Node.TEXT_NODE && n.textContent === GUARD;

/** Characters that count, in a text node's content. */
const countOf = (v: string): number => v.length - (v.match(GUARD_RE)?.length ?? 0);

/**
 * The caret as a count of characters, each chip counting as one and guards
 * counting as nothing.
 *
 * A Range dies the moment a repaint replaces the nodes it points at; a number
 * survives. Used around explicit repaints and normalisation, and on the typing
 * path only when `lineIsCanonical` has found something to put straight.
 */
export function caretUnits(root: HTMLElement | null): number | null {
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!root || !sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer)) return null;
  return unitsOfPosition(root, r.startContainer, r.startOffset);
}

/**
 * Restore a caret recorded by caretUnits, always inside a text node.
 *
 * At a chip's edge the text there is a guard, and the caret goes past it: the
 * one place in the gap, drawn by the browser at the guard's position, which is
 * where the two chips' margins meet.
 */
export function setCaretUnits(root: HTMLElement | null, units: number): void {
  if (!root) return;
  let n = 0;
  for (const c of Array.from(root.childNodes)) {
    const len = lengthOf(c);
    if (c.nodeType === Node.TEXT_NODE) {
      if (units <= n + len) {
        placeCaret(root, c as Text, offsetIn(c as Text, units - n));
        return;
      }
    } else if (units <= n + len) {
      // a chip cannot hold a caret, so use the text just after it
      const next = c.nextSibling;
      if (next?.nodeType === Node.TEXT_NODE) {
        placeCaret(root, next as Text, offsetIn(next as Text, 0));
        return;
      }
      break;
    }
    n += len;
  }
  caretToEnd(root);
}

/** The DOM offset in a text node for a count of characters into it, guards skipped. */
export function offsetIn(text: Text, units: number): number {
  const v = text.textContent ?? '';
  if (v === GUARD) return 1;
  let seen = 0;
  let i = 0;
  while (i < v.length && seen < units) {
    if (v[i] !== GUARD) seen += 1;
    i += 1;
  }
  return i;
}

/**
 * Put the caret at the end of the line, inside a text node.
 *
 * The "give me the caret back" entry point, used when focus really did leave
 * (a Radix menu closing, the file dialog). Focusing is a genuine transition,
 * which is exactly when Chromium re-establishes an editing caret; it is a
 * no-op when the line already has focus.
 */
export function caretToEnd(root: HTMLElement | null): void {
  if (!root) return;
  root.focus({ preventScroll: true });
  const last = root.lastChild;
  if (last?.nodeType === Node.TEXT_NODE) {
    placeCaret(root, last as Text, (last as Text).length);
    return;
  }
  // an empty line has nothing to anchor to, and has to stay :empty for its
  // placeholder, so the host caret is the right answer there
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(root);
  r.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(r);
}

/**
 * Whether something in the line is selected, rather than a caret sitting in it.
 *
 * A drag that selects text ends in a click on the same element, so a click
 * handler cannot treat every click as "put the caret here" — doing that wipes
 * the selection the drag just made, which looked like text refusing to stay
 * selected at all.
 */
export function hasSelectionIn(root: HTMLElement | null): boolean {
  if (!root) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  return root.contains(r.startContainer) && root.contains(r.endContainer);
}

export function placeCaret(root: HTMLElement, node: Text, offset: number) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.setStart(node, Math.max(0, Math.min(offset, node.length)));
  r.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(r);
  void root;
}

export const lengthOf = (n: ChildNode): number => (n.nodeType === Node.TEXT_NODE ? countOf(n.textContent ?? '') : 1);

/**
 * A (node, offset) position as caret units, without touching the selection.
 *
 * The same walk `caretUnits` does over the live selection, generalized to any
 * position — the drop math needs to measure where a point landed before
 * anything is moved there.
 */
export function unitsOfPosition(root: HTMLElement, node: Node, offset: number): number {
  if (node === root) {
    let n = 0;
    for (let i = 0; i < offset && i < root.childNodes.length; i++) n += lengthOf(root.childNodes[i]);
    return n;
  }
  let n = 0;
  for (const c of Array.from(root.childNodes)) {
    if (c === node) return n + countOf((c.textContent ?? '').slice(0, offset));
    if (c.contains(node)) return n + 1; // inside a chip counts as just after it
    n += lengthOf(c);
  }
  return n;
}
