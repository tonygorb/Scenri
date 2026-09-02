import { lengthOf, placeCaret, placeCaretAt, setCaretUnits } from './caret.js';
import { normalizeLine } from './invariants.js';
import { textBeforeCaret } from './query.js';

// ---------------------------------------------------------------- insert and remove

export interface InsertOptions {
  /** Only a slash-menu pick consumes the "/query" that opened the menu. */
  eatQuery?: boolean;
  /** Where the caret was before focus left the line (file dialog, search box). */
  fallbackUnits?: number | null;
}

/**
 * Drop a chip where the caret is and leave the caret right after it.
 *
 * Nothing but the chip goes in: the chip owns its gap as a margin, and the
 * spaces around it, if the user wants any, are the user's to type. A caret in
 * text splits the run around the chip; a caret on the line itself, between two
 * chips or at the end, puts the chip at that index. Either way the caret ends
 * flush after the chip, in the text that follows when there is some and on
 * the line itself when there is not.
 */
export function insertToken(root: HTMLElement | null, chip: HTMLElement, opts: InsertOptions = {}): void {
  if (!root) return;
  const sel = window.getSelection();
  let range: Range | null = null;
  if (sel && sel.rangeCount > 0 && root.contains(sel.getRangeAt(0).startContainer)) {
    range = sel.getRangeAt(0);
  } else if (opts.fallbackUnits != null) {
    setCaretUnits(root, opts.fallbackUnits);
    const live = window.getSelection();
    if (live && live.rangeCount > 0 && root.contains(live.getRangeAt(0).startContainer)) range = live.getRangeAt(0);
  }
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.deleteContents(); // a highlighted stretch is what the chip replaces

  const container = range.startContainer;
  if (container.nodeType === Node.TEXT_NODE && container.parentNode === root) {
    const host = container as Text;
    const full = host.textContent ?? '';
    let before = full.slice(0, range.startOffset);
    const after = full.slice(range.startOffset);
    if (opts.eatQuery) before = eatQuery(host, before);
    host.textContent = before;
    root.insertBefore(chip, host.nextSibling);
    if (after) {
      const rest = document.createTextNode(after);
      root.insertBefore(rest, chip.nextSibling);
      placeCaret(root, rest, 0);
    } else {
      placeCaretAt(root, Array.from(root.childNodes).indexOf(chip) + 1);
    }
  } else {
    // on the line itself, or somewhere the caret should not be (inside a chip):
    // the chip goes at the caret's child index, or at the end
    const index = container === root ? range.startOffset : root.childNodes.length;
    const ref = root.childNodes[index] ?? null;
    root.insertBefore(chip, ref);
    if (ref?.nodeType === Node.TEXT_NODE) placeCaret(root, ref as Text, 0);
    else placeCaretAt(root, Array.from(root.childNodes).indexOf(chip) + 1);
  }
  normalizeLine(root);
}

/** `$` a product; `/` a scene; `@` a presenter; `#` a colour. */
export const SIGILS = ['$', '/', '@', '#'] as const;
export type Sigil = (typeof SIGILS)[number];
const isSigil = (c: string): c is Sigil => (SIGILS as readonly string[]).includes(c);
export const isBreak = (c: string) => c === ' ' || c === '\n' || c === '\u00a0';

/**
 * The sigil query the caret currently sits in, or null.
 *
 * A sigil only counts at the start of a word. That single rule is what keeps
 * `#F5C518` a hex colour and `tony@example.com` an address: in both the
 * character has a letter or digit in front of it, so no menu opens. Whitespace
 * closes a query, so a menu never survives past the word it started.
 */
export function sigilAtCaret(root: HTMLElement | null): { sigil: Sigil; query: string } | null {
  const before = textBeforeCaret(root);
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];
    if (isBreak(ch)) return null;
    if (isSigil(ch)) {
      const atWordStart = i === 0 || isBreak(before[i - 1]);
      return atWordStart ? { sigil: ch, query: before.slice(i + 1) } : null;
    }
  }
  return null;
}

/** Remove the "$query", "/query", "@query" or "#query" that opened the menu, even across text nodes. */
function eatQuery(host: Text, before: string): string {
  const cut = (v: string) => Math.max(v.lastIndexOf('$'), v.lastIndexOf('/'), v.lastIndexOf('@'), v.lastIndexOf('#'));
  const here = cut(before);
  if (here >= 0) return before.slice(0, here);
  const wipe: ChildNode[] = [];
  for (let n = host.previousSibling; n && n.nodeType === Node.TEXT_NODE; n = n.previousSibling) {
    const v = n.textContent ?? '';
    const i = cut(v);
    if (i >= 0) {
      n.textContent = v.slice(0, i);
      for (const w of wipe) w.remove();
      return '';
    }
    wipe.push(n);
  }
  return before;
}

/** Take a chip out and close the gap, leaving the caret at the seam. */
export function removeChip(root: HTMLElement | null, chip: Element | null): void {
  if (!root || !chip) return;
  root.normalize();
  const before = unitsBeforeChip(root, chip);
  chip.remove();
  normalizeLine(root);
  setCaretUnits(root, before);
}

/**
 * Characters before a node, a chip counting as one.
 *
 * Exported because a caret has to be worked out *before* a chip is taken out
 * of the line, not after: once the node is gone there is nothing left to
 * measure from. `removeChip` uses it for its own restore; the picker needs the
 * same number to hand back to a line it has to re-focus first.
 */
export function unitsBeforeChip(root: HTMLElement, node: Node): number {
  let n = 0;
  for (const c of Array.from(root.childNodes)) {
    if (c === node) break;
    n += lengthOf(c);
  }
  return n;
}
