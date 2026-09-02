import { CHIP, CHIP_SELECTOR } from './tokens.js';
import { caretUnits, setCaretUnits } from './caret.js';

// ---------------------------------------------------------------- the invariants

/**
 * Bring the line back to its canonical shape, carrying the caret across.
 *
 * The line holds the user's text and the chips, and nothing else. A chip is an
 * inline atom that owns its own gap as a margin (composer-brief.css), so no
 * space is ever put beside one on the user's behalf, and the spaces they type
 * are theirs. What is left to keep straight is the browser's own untidiness:
 *
 *  - no empty text nodes, no adjacent text nodes
 *  - the empty-line leftovers, so the placeholder can come back
 */
export function normalizeLine(root: HTMLElement | null): void {
  if (!root) return;
  const units = caretUnits(root);
  root.normalize();
  for (const n of Array.from(root.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE && !(n.textContent ?? '').length) n.remove();
  }
  // Chromium leaves a lone <br> (or an empty wrapper) when the user clears the
  // line. Strip it and keep data-empty in sync for the placeholder.
  if (syncEmpty(root)) return;
  if (units !== null) setCaretUnits(root, units);
}

/**
 * True when the line has no chips and no real text.
 *
 * Chromium often leaves a lone <br>, a zwsp, or an empty <div><br></div>
 * wrapper after the user clears the line — none of those count as content.
 */
export function isBlankLine(root: HTMLElement): boolean {
  if (root.querySelector(CHIP_SELECTOR)) return false;
  return !(root.textContent ?? '').replace(/[​﻿ ]/g, '').trim();
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

export const isChip = (n: ChildNode | null): boolean =>
  !!n && n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).classList.contains(CHIP);
