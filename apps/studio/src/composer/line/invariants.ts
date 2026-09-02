import { CHIP, CHIP_SELECTOR } from './tokens.js';
import { caretUnits, lengthOf, placeCaret, setCaretUnits } from './caret.js';

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
    let v = n.textContent ?? '';
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

// ---------------------------------------------------------------- the boundary, on the typing path

/**
 * The chip-boundary rule on its own, safe to run on every keystroke.
 *
 * `normalizeLine` states the same rule after a structural edit and can afford
 * to rebuild the line around it. This runs on the typing path instead, so it
 * does nothing at all until a boundary actually needs it, and it carries the
 * caret when it does.
 *
 * It merges the line's text nodes first, and that is the whole point. Chromium
 * deletes a chip by taking the element out and leaving the two spaces that
 * surrounded it as SEPARATE text nodes. A pass that measures one node at a time
 * reads a single space on each side, finds nothing to collapse, and leaves the
 * line rendering both of them (`white-space: pre-wrap`) as a doubled gap that
 * survives until the next structural edit. Two earlier passes each missed this
 * for exactly that reason; merging first is what makes one rule enough.
 */
export function normalizeChipBoundaries(root: HTMLElement | null): boolean {
  if (!root) return false;
  if (!splitOrDoubledBoundary(root) && !caretWedgedInSpaces(root)) return false;

  // Units count characters, and a merge changes no character, so the caret
  // survives being re-anchored into the node the merge left behind.
  const at = caretUnits(root);
  root.normalize();
  // Two chips left touching (their space selected and deleted) get it back
  // before the caret is re-anchored: a caret between two chips has no text
  // node to land in, and would otherwise be sent to the end of the line.
  let minted: Text | null = null;
  for (const n of Array.from(root.childNodes)) {
    if (isChip(n) && isChip(n.nextSibling)) {
      minted = document.createTextNode(' ');
      root.insertBefore(minted, n.nextSibling);
    }
  }
  if (at !== null) setCaretUnits(root, at);

  let changed = collapseBoundaryRuns(root);
  if (collapseSpaceAtCaret(root)) changed = true;
  if (minted) {
    // the far edge of a chip's space is the one stop the keys know (see keys.ts)
    const sel = window.getSelection();
    const r = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    if (r?.collapsed && r.startContainer === minted && r.startOffset === 0) placeCaret(root, minted, 1);
    changed = true;
  }
  return changed;
}

/** Is there anything at a boundary worth waking the caret up for? */
function splitOrDoubledBoundary(root: HTMLElement): boolean {
  const kids = root.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== Node.TEXT_NODE) continue;
    const v = n.textContent ?? '';
    const next = kids[i + 1] ?? null;
    // A split run only matters when its seam could be holding a space: the two
    // halves of a word are none of this rule's business.
    if (next?.nodeType === Node.TEXT_NODE && (v.endsWith(' ') || (next.textContent ?? '').startsWith(' '))) return true;
    if (isChip(n.previousSibling) && /^ {2,}/.test(v)) return true;
    if (isChip(n.nextSibling) && / {2,}$/.test(v)) return true;
  }
  for (const n of Array.from(kids)) if (isChip(n) && isChip(n.nextSibling)) return true;
  return false;
}

/**
 * Exactly one space where a run meets a chip.
 *
 * Only the runs that touch a chip are touched, and only at the end that touches
 * it, so a space the user typed in the middle of their own sentence is never
 * this rule's business.
 */
function collapseBoundaryRuns(root: HTMLElement): boolean {
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  const range = sel && sel.rangeCount > 0 && sel.getRangeAt(0).collapsed ? sel.getRangeAt(0) : null;
  let changed = false;
  for (const n of Array.from(root.childNodes)) {
    if (n.nodeType !== Node.TEXT_NODE) continue;
    const text = n as Text;
    const v = text.textContent ?? '';
    const lead = isChip(n.previousSibling) ? (v.match(/^ +/)?.[0].length ?? 0) : 0;
    const trail = isChip(n.nextSibling) ? (v.match(/ +$/)?.[0].length ?? 0) : 0;
    if (lead < 2 && trail < 2) continue;
    let at = range && range.startContainer === text ? range.startOffset : -1;
    let out = v;
    if (lead === v.length) {
      // spaces only, a chip on each side: one space, caret just past it
      out = ' ';
      if (at >= 0) at = Math.min(at, 1);
    } else {
      if (lead > 1) {
        out = ` ${out.slice(lead)}`;
        if (at >= 0) at = at <= lead ? Math.min(at, 1) : at - (lead - 1);
      }
      if (trail > 1) {
        const keep = out.length - trail;
        out = `${out.slice(0, keep)} `;
        if (at >= 0) at = at >= keep ? keep + 1 : at;
      }
    }
    text.textContent = out;
    if (at >= 0) placeCaret(root, text, at);
    changed = true;
  }
  return changed;
}

/**
 * The seam a chip deleted with Backspace or Delete leaves behind.
 *
 * Wedged BETWEEN two spaces is the signature of a deletion, never of typing: a
 * typed space leaves the caret past the run it just grew, so a double space the
 * user wrote on purpose is never mistaken for this.
 */
function collapseSpaceAtCaret(root: HTMLElement): boolean {
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.getRangeAt(0).collapsed) return false;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return false;
  const text = node as Text;
  const to = collapseSpaceRunAt(text, range.startOffset, true);
  if (to === null) return false;
  placeCaret(root, text, to);
  return true;
}

function caretWedgedInSpaces(root: HTMLElement): boolean {
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.getRangeAt(0).collapsed) return false;
  const range = sel.getRangeAt(0);
  if (range.startContainer.nodeType !== Node.TEXT_NODE || !root.contains(range.startContainer)) return false;
  const v = range.startContainer.textContent ?? '';
  return v[range.startOffset - 1] === ' ' && v[range.startOffset] === ' ';
}

/**
 * Collapse the run of spaces spanning `index` to one, and say where that space
 * now ends. `wedged` asks for the strict test: a run only counts when the index
 * has a space on both sides of it.
 *
 * Exported for `removeChip`, which is the one caller that knows exactly where
 * its seam is because it measured it before taking the chip out.
 */
export function collapseSpaceRunAt(text: Text, index: number, wedged = false): number | null {
  const v = text.textContent ?? '';
  if (wedged && (v[index - 1] !== ' ' || v[index] !== ' ')) return null;
  let start = index;
  while (start > 0 && v[start - 1] === ' ') start--;
  let end = index;
  while (end < v.length && v[end] === ' ') end++;
  if (end - start < 2) return null;
  text.textContent = `${v.slice(0, start)} ${v.slice(end)}`;
  return start + 1;
}

/**
 * Close the seam a chip leaves when it is lifted out of the line.
 *
 * A chip owns one space on each side. Take it away and those two spaces meet,
 * which is the one and only place a removal or a reorder can double a space.
 * The position is measured in units before the chip is lifted, because that is
 * the last moment there is anything to measure from; the caller passes it back
 * once the line has been merged.
 *
 * Scoped on purpose. The line-wide collapse this replaces could not tell a
 * seam from a space the user typed in the middle of their own sentence.
 */
export function closeSeamAt(root: HTMLElement, units: number): void {
  let n = 0;
  for (const c of Array.from(root.childNodes)) {
    const len = lengthOf(c);
    if (units <= n + len) {
      if (c.nodeType === Node.TEXT_NODE) collapseSpaceRunAt(c as Text, units - n);
      return;
    }
    n += len;
  }
}
