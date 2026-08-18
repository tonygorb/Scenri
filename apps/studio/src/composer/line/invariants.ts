import { CHIP, CHIP_SELECTOR } from './tokens.js';
import { caretUnits, setCaretUnits } from './caret.js';

// ---------------------------------------------------------------- the invariants

/**
 * Bring the line back to its canonical shape, carrying the caret across.
 *
 * Every structural edit ends here, so the rules live in exactly one place:
 *
 *  - no empty text nodes, no adjacent text nodes
 *  - exactly one space on each side of a chip
 *  - no space at the very start
 *  - a text node always follows a trailing chip, so there is somewhere to type
 */
export function normalizeLine(root: HTMLElement | null): void {
  if (!root) return;
  const at = caretUnits(root);

  root.normalize();
  for (const n of Array.from(root.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE && !(n.textContent ?? '').length) n.remove();
  }

  const kids = Array.from(root.childNodes);
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== Node.TEXT_NODE) continue;
    let v = (n.textContent ?? '').replace(/ {2,}/g, ' ');
    const prevIsChip = isChip(n.previousSibling);
    const nextIsChip = isChip(n.nextSibling);
    if (prevIsChip)
      v = v.replace(/^ */, ' '); // exactly one, never none
    else if (!n.previousSibling) v = v.replace(/^ +/, ''); // nothing leads the sentence
    if (nextIsChip) v = v.replace(/ *$/, ' ');
    n.textContent = v;
  }

  // chips that ended up shoulder to shoulder need the space between them
  for (const n of Array.from(root.childNodes)) {
    if (isChip(n) && isChip(n.nextSibling)) {
      root.insertBefore(document.createTextNode(' '), n.nextSibling);
    }
  }
  if (isChip(root.lastChild)) root.appendChild(document.createTextNode(' '));
  if (isChip(root.firstChild)) root.insertBefore(document.createTextNode(''), root.firstChild);

  // Chromium leaves a lone <br> (or an empty wrapper) when the user clears the
  // line. Strip it and keep data-empty in sync for the placeholder.
  if (syncEmpty(root)) return;

  if (at !== null) setCaretUnits(root, at);
}

/**
 * True when the line has no chips and no real text.
 *
 * Chromium often leaves a lone <br>, a zwsp, or an empty <div><br></div>
 * wrapper after the user clears the line — none of those count as content.
 */
export function isBlankLine(root: HTMLElement): boolean {
  if (root.querySelector(CHIP_SELECTOR)) return false;
  return !(root.textContent ?? '').replace(/[\u200B\uFEFF\u00a0]/g, '').trim();
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
