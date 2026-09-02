import { lengthOf, placeCaret, setCaretUnits } from './caret.js';
import { isChip, normalizeLine } from './invariants.js';
import { textBeforeCaret } from './query.js';

// ---------------------------------------------------------------- insert and remove

export interface InsertOptions {
  /** Only a slash-menu pick consumes the "/query" that opened the menu. */
  eatQuery?: boolean;
  /** Where the caret was before focus left the line (file dialog, search box). */
  fallbackUnits?: number | null;
}

/**
 * Drop a chip where the caret is and leave the caret after it.
 *
 * The caret's own text node is REUSED as the single space that follows the
 * chip, and the surrounding text is rebuilt around it. Splitting the node the
 * ordinary way would leave the browser's anchor on the half before the chip,
 * which is what made a chip look appended while typing carried on in front of
 * it. Because the node the browser points at is the one that ends up after the
 * chip, its offset simply clamps to the end of that space and no programmatic
 * caret move is needed at all.
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

  let host: Text;
  let at: number;
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    host = range.startContainer as Text;
    at = range.startOffset;
  } else {
    const parentEl = range.startContainer as HTMLElement;
    host = document.createTextNode('');
    parentEl.insertBefore(host, parentEl.childNodes[range.startOffset] ?? null);
    at = 0;
  }

  const full = host.textContent ?? '';
  let before = full.slice(0, at);
  const after = full.slice(at);

  if (opts.eatQuery) before = eatQuery(host, before);

  const parent = host.parentNode;
  if (!parent) return;
  host.textContent = ' ';
  if (after.trim() || after.length > 1) parent.insertBefore(document.createTextNode(after), host.nextSibling);
  parent.insertBefore(chip, host);
  if (before) parent.insertBefore(document.createTextNode(before), chip);

  /*
   * Then say where the caret goes, explicitly.
   *
   * Reusing the node is what keeps the browser's anchor on the right side of
   * the chip, but rewriting that node's text resets its offset, so the caret
   * would sit at the start of the space and the next keystroke would run into
   * the chip's label. This assignment is honoured because the line never lost
   * focus: every control that can insert cancels mousedown (see keepCaret).
   */
  placeCaret(root, host, host.length);
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

/**
 * Exactly one space on each side of a chip, kept while typing.
 *
 * `normalizeLine` states the rule after every structural edit, but a space
 * typed at a chip's edge lands in the single space the chip already owns and
 * made two: an 8px gap between two chips, and a second caret slot in it. This
 * runs on every input, touches only the runs that meet a chip, and carries the
 * caret across so the keystroke still feels like it happened.
 */
export function collapseChipSpaces(root: HTMLElement | null): boolean {
  if (!root) return false;
  const sel = window.getSelection();
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

/** True when the caret sits between two spaces, as a deleted chip leaves it. */
export function collapseDoubleSpaceAtCaret(root: HTMLElement | null): void {
  if (!root) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.getRangeAt(0).collapsed) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return;
  const text = node as Text;
  const v = text.textContent ?? '';
  const at = range.startOffset;
  if (v[at - 1] !== ' ' || v[at] !== ' ') return;
  text.textContent = v.slice(0, at) + v.slice(at + 1);
  placeCaret(root, text, at);
}
