import { CHIP, CHIP_SELECTOR } from './tokens.js';
import { caretUnits, lengthOf, placeCaret, setCaretUnits } from './caret.js';

// ---------------------------------------------------------------- the invariants

/**
 * Bring the line back to its canonical shape, carrying the caret across.
 *
 * Two callers, two amounts of shaping. A structural edit (a chip inserted,
 * removed, moved, pasted, a brief hydrated) ends here with the sentence
 * shaped around its chips, the way the frames read: exactly one space on each
 * side of a chip, none leading the line. A keystroke ends here too, through
 * `lineIsCanonical`, but with `shapeProse: false`: nothing the user is typing
 * is touched, only what the browser split is merged and the chips are kept
 * hosted and one space apart. The space between two chips, and after a last
 * one, is the chip's: it is the 4px gap the frames draw and the text a caret
 * needs to sit in, which a phone will not do without.
 */
export function normalizeLine(root: HTMLElement | null, opts: { shapeProse?: boolean } = {}): void {
  if (!root) return;
  const shapeProse = opts.shapeProse !== false;
  const units = caretUnits(root);

  // Merge first: a live range follows a merge, so the caret read after it is
  // the one to carry.
  root.normalize();
  const caret = caretIn(root);
  let at = caret?.at ?? 0;
  for (const n of Array.from(root.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE && !(n.textContent ?? '').length) n.remove();
  }

  for (const n of Array.from(root.childNodes)) {
    if (n.nodeType !== Node.TEXT_NODE) continue;
    const before = n.textContent ?? '';
    let v = before;
    const prevIsChip = isChip(n.previousSibling);
    const nextIsChip = isChip(n.nextSibling);
    if (prevIsChip && nextIsChip && /^ +$/.test(v)) {
      v = ' '; // the one space two chips share, whatever met there
    } else if (shapeProse) {
      if (prevIsChip)
        v = v.replace(/^ */, ' '); // exactly one, never none
      else if (!n.previousSibling) v = v.replace(/^ +/, ''); // nothing leads the sentence
      if (nextIsChip) v = v.replace(/ *$/, ' ');
    }
    if (v === before) continue;
    if (caret?.text === n) {
      // what changed at the start of the run moves the caret; what changed at
      // the end only ever clamps it
      const leadBefore = before.match(/^ */)?.[0].length ?? 0;
      const leadAfter = v.match(/^ */)?.[0].length ?? 0;
      at = at <= leadBefore ? Math.min(at, leadAfter) : at + (leadAfter - leadBefore);
      at = Math.min(at, v.length);
    }
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

  if (caret && caret.text.parentNode === root) placeCaret(root, caret.text, at);
  else if (units !== null) setCaretUnits(root, units);
}

/**
 * Whether a keystroke has left the line short of the shape it keeps while
 * typing: chips hosted and one space apart, no run the browser split. Cheap
 * on purpose: it runs on every input and touches nothing, and it asks nothing
 * of the prose, which is the user's while they type. A stray element the
 * browser left, a <br> say, is not this rule's business.
 */
export function lineIsCanonical(root: HTMLElement | null): boolean {
  if (!root) return true;
  const kids = root.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (isChip(n)) {
      if (!n.nextSibling || isChip(n.nextSibling)) return false; // touching, or nowhere to type
      continue;
    }
    if (n.nodeType !== Node.TEXT_NODE) continue;
    const v = n.textContent ?? '';
    const next = kids[i + 1] ?? null;
    if (next?.nodeType === Node.TEXT_NODE) return false; // a run the browser split
    if (!v) {
      if (i === 0 && isChip(next)) continue; // the one empty node allowed: the host before a leading chip
      return false;
    }
    // between two chips: their one shared space, nothing more
    if (isChip(n.previousSibling) && isChip(next) && /^ +$/.test(v) && v.length !== 1) return false;
  }
  return true;
}

/**
 * True when the line has no chips and no real text.
 *
 * Chromium often leaves a lone <br>, a zwsp, or an empty <div><br></div>
 * wrapper after the user clears the line — none of those count as content.
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

export const isChip = (n: ChildNode | null): boolean =>
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

// ---------------------------------------------------------------- the seam a chip leaves

/**
 * The seam a selection deleted across a chip leaves in prose.
 *
 * A chip owns one space on each side; take the chip out of the middle of a
 * sentence and those two meet as a double space that is no chip's edge, so
 * the line's rules do not see it. Wedged BETWEEN two spaces is the signature
 * of that deletion and never of typing, which leaves the caret past the run it
 * just grew, so a double space the user wrote on purpose is never mistaken for
 * it.
 */
export function collapseSpaceAtCaret(root: HTMLElement | null): boolean {
  const c = caretIn(root);
  if (!c || !root) return false;
  const to = collapseSpaceRunAt(c.text, c.at, true);
  if (to === null) return false;
  placeCaret(root, c.text, to);
  return true;
}

/**
 * Collapse the run of spaces spanning `index` to one, and say where that space
 * now ends. `wedged` asks for the strict test: a run only counts when the index
 * has a space on both sides of it.
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
 * once the line has been merged. Scoped on purpose: a line-wide collapse could
 * not tell a seam from a space the user typed in the middle of a sentence.
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
