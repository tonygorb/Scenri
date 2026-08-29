// ---------------------------------------------------------------- caret, as an offset

/**
 * The caret as a count of characters, each chip counting as one.
 *
 * A Range dies the moment a repaint replaces the nodes it points at; a number
 * survives. Used only around explicit repaints and normalisation, never on the
 * typing path.
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

/** Restore a caret recorded by caretUnits, always inside a real text node. */
export function setCaretUnits(root: HTMLElement | null, units: number): void {
  if (!root) return;
  let n = 0;
  for (const c of Array.from(root.childNodes)) {
    const len = lengthOf(c);
    if (units <= n + len) {
      if (c.nodeType === Node.TEXT_NODE) {
        placeCaret(root, c as Text, units - n);
        return;
      }
      // a chip cannot hold a caret, so use the text just after it
      const next = c.nextSibling;
      if (next?.nodeType === Node.TEXT_NODE) {
        placeCaret(root, next as Text, 0);
        return;
      }
      break;
    }
    n += len;
  }
  caretToEnd(root);
}

/**
 * Put the caret at the end of the line, inside a real text node.
 *
 * selectNodeContents + collapse anchors the caret to the editable host itself
 * (container is the div, offset is a child index). Chromium will not type into
 * that position when the line ends in a contenteditable=false chip: it drops
 * the next keystroke at offset 0 instead, which reads as "I cannot type after
 * the chip".
 */
export function caretToEnd(root: HTMLElement | null): void {
  if (!root) return;
  // This is the "give me the caret back" entry point, used when focus really
  // did leave (a Radix menu closing, the file dialog). Focusing is safe here:
  // it is a genuine transition, which is exactly when Chromium re-establishes
  // an editing caret. It is a no-op when the line already has focus.
  root.focus({ preventScroll: true });
  if (!root.firstChild) {
    // an empty line has nothing to anchor to, and has to stay :empty for its
    // placeholder, so the host caret is the right answer there
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(root);
    r.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(r);
    return;
  }
  const tail = tailText(root);
  placeCaret(root, tail, tail.length);
}

/** The line's last text node, adding the space a trailing chip needs. */
export function tailText(root: HTMLElement): Text {
  const last = root.lastChild;
  if (last && last.nodeType === Node.TEXT_NODE) return last as Text;
  const t = document.createTextNode(' ');
  root.appendChild(t);
  return t;
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
