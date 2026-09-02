// ---------------------------------------------------------------- caret, as an offset

/**
 * The caret as a count of characters, each chip counting as one.
 *
 * A Range dies the moment a repaint replaces the nodes it points at; a number
 * survives. Used around explicit repaints and normalisation.
 */
export function caretUnits(root: HTMLElement | null): number | null {
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!root || !sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer)) return null;
  if (r.startContainer === root) {
    let n = 0;
    for (let i = 0; i < r.startOffset && i < root.childNodes.length; i++) n += lengthOf(root.childNodes[i]);
    return n;
  }
  let n = 0;
  for (const c of Array.from(root.childNodes)) {
    if (c === r.startContainer) return n + r.startOffset;
    if (c.contains(r.startContainer)) return n + 1; // inside a chip counts as just after it
    n += lengthOf(c);
  }
  return n;
}

/**
 * Restore a caret recorded by caretUnits.
 *
 * Inside a text node whenever there is one; on the line itself, between two
 * chips or after the last one, when there is not. That position is a real
 * caret position: arrows stop there and typing there makes the text node.
 */
export function setCaretUnits(root: HTMLElement | null, units: number): void {
  if (!root) return;
  const kids = Array.from(root.childNodes);
  let n = 0;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    const len = lengthOf(c);
    if (c.nodeType === Node.TEXT_NODE) {
      if (units <= n + len) {
        placeCaret(root, c as Text, units - n);
        return;
      }
    } else {
      if (units === n) {
        placeCaretAt(root, i);
        return;
      }
      if (units === n + 1) {
        const next = kids[i + 1];
        if (next?.nodeType === Node.TEXT_NODE) placeCaret(root, next as Text, 0);
        else placeCaretAt(root, i + 1);
        return;
      }
    }
    n += len;
  }
  placeCaretAt(root, kids.length);
}

/**
 * Put the caret at the end of the line.
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
  if (last?.nodeType === Node.TEXT_NODE) placeCaret(root, last as Text, (last as Text).length);
  else placeCaretAt(root, root.childNodes.length);
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

/** The caret on the line itself, before the child at `index`: between two chips, or after the last node. */
export function placeCaretAt(root: HTMLElement, index: number) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.setStart(root, Math.max(0, Math.min(index, root.childNodes.length)));
  r.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(r);
}

export const lengthOf = (n: ChildNode): number => (n.nodeType === Node.TEXT_NODE ? (n.textContent ?? '').length : 1);

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
    if (c === node) return n + offset;
    if (c.contains(node)) return n + 1; // inside a chip counts as just after it
    n += lengthOf(c);
  }
  return n;
}
