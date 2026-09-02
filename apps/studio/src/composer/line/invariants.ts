import { CHIP, CHIP_SELECTOR } from './tokens.js';
import { GUARD, GUARD_RE, caretUnits, isGuard, setCaretUnits } from './caret.js';

// ---------------------------------------------------------------- the invariants

/**
 * Bring the line back to its canonical shape, carrying the caret across.
 *
 * Every edit ends here, a structural one directly and a keystroke by way of
 * `lineIsCanonical`, and the rules are about the chips, never the prose. The
 * spaces beside a chip are the user's, typed or not: nothing is put beside
 * their words on their behalf and nothing they typed is taken away. What the
 * line keeps straight is the browser's untidiness and the chips' hosts:
 *
 *  - no empty text nodes, no adjacent text nodes
 *  - a text node on both sides of every chip: the text the user typed, or
 *    where there is none, a guard, one zero-width character that gives a caret
 *    somewhere to sit (a phone shows no caret anywhere else). Two chips that
 *    touch share one guard; the chip's margin is their visible gap.
 *  - a guard is never mixed with text and never left where no chip needs it
 */
export function normalizeLine(root: HTMLElement | null): void {
  if (!root) return;
  const units = caretUnits(root);

  root.normalize();
  for (const n of Array.from(root.childNodes)) {
    if (n.nodeType !== Node.TEXT_NODE) continue;
    const v = n.textContent ?? '';
    // typed into a guard, the text is the host now; two guards that met are one
    const bare = v.replace(GUARD_RE, '');
    const keep = bare.length ? bare : v.length ? GUARD : '';
    if (keep !== v) n.textContent = keep;
    if (!keep) n.remove();
  }
  // a guard stands only where a chip has no text beside it
  for (const n of Array.from(root.childNodes)) {
    if (isGuard(n) && !isChip(n.previousSibling) && !isChip(n.nextSibling)) n.remove();
  }
  for (const n of Array.from(root.childNodes)) {
    if (!isChip(n)) continue;
    if (n.previousSibling?.nodeType !== Node.TEXT_NODE) root.insertBefore(document.createTextNode(GUARD), n);
    if (n.nextSibling?.nodeType !== Node.TEXT_NODE) root.insertBefore(document.createTextNode(GUARD), n.nextSibling);
  }

  // Chromium leaves a lone <br> (or an empty wrapper) when the user clears the
  // line. Strip it and keep data-empty in sync for the placeholder.
  if (syncEmpty(root)) return;
  if (units !== null) setCaretUnits(root, units);
}

/**
 * Whether a keystroke has left the line short of its shape: a run the
 * browser split, a guard typed into, a chip with no text beside it. Cheap on
 * purpose: it runs on every input and touches nothing, and it asks nothing of
 * the prose. A stray element the browser left, a <br> say, is not this rule's
 * business.
 */
export function lineIsCanonical(root: HTMLElement | null): boolean {
  if (!root) return true;
  const kids = root.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (isChip(n)) {
      if (n.previousSibling?.nodeType !== Node.TEXT_NODE || n.nextSibling?.nodeType !== Node.TEXT_NODE) return false;
      continue;
    }
    if (n.nodeType !== Node.TEXT_NODE) continue;
    const v = n.textContent ?? '';
    if (!v) return false;
    if (kids[i + 1]?.nodeType === Node.TEXT_NODE) return false; // a run the browser split
    if (v.includes(GUARD)) {
      if (v !== GUARD) return false; // typed into
      if (!isChip(n.previousSibling) && !isChip(n.nextSibling)) return false; // orphaned
    }
  }
  return true;
}

/**
 * True when the line has no chips and no real text.
 *
 * Chromium often leaves a lone <br>, a zwsp, or an empty <div><br></div>
 * wrapper after the user clears the line — none of those count as content,
 * and neither do the guards.
 */
export function isBlankLine(root: HTMLElement): boolean {
  if (root.querySelector(CHIP_SELECTOR)) return false;
  return !(root.textContent ?? '').replace(/[​﻿ ]/g, '').trim();
}

/**
 * Drop empty-editor leftovers and mirror blankness onto data-empty.
 *
 * The placeholder is driven by [data-empty], not :empty — :empty fails as soon
 * as Chromium inserts a <br> on focus or after a clear.
 */
export function syncEmpty(root: HTMLElement | null): boolean {
  if (!root) return false;
  const blank = isBlankLine(root);
  if (blank && root.firstChild) root.replaceChildren();
  root.toggleAttribute('data-empty', blank);
  return blank;
}

export const isChip = (n: ChildNode | null | undefined): boolean =>
  !!n && n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).classList.contains(CHIP);

/** The collapsed caret, when it sits in one of the line's own text nodes. */
export function caretIn(root: HTMLElement | null): { text: Text; at: number } | null {
  if (!root) return null;
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.getRangeAt(0).collapsed) return null;
  const r = sel.getRangeAt(0);
  const node = r.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || node.parentNode !== root) return null;
  return { text: node as Text, at: r.startOffset };
}
