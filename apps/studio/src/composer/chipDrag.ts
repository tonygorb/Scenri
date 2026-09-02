import { caretBeside, chipAt, dropUnitsAt, moveAnnouncement, moveChipToUnits } from './line.js';

/**
 * Pointer-drag reordering for the brief's chips.
 *
 * Hand-rolled on pointer events, deliberately: the line's children are
 * imperative DOM that React never owns, so a React DnD library has nothing to
 * sort, and the browser's native node-drag of a contenteditable=false atom
 * moves the node itself behind the line's back — no emit, no normalize, no
 * keyboard story. BriefInput suppresses that (draggable=false + a dragstart
 * guard) and this controller replaces it: a 5px threshold keeps clicks
 * clicks, the drop target is a caret position snapped to word boundaries and
 * chip edges (dropUnitsAt), and the drop lands through the same
 * move-normalize-emit path the keyboard uses.
 *
 * Mouse and pen only. Touch never arms: a long-press drag inside a
 * contenteditable fights the OS selection callout and the two directions this
 * surface already scrolls, so the touch path is the chip sheet's Move buttons.
 *
 * Sortable-list neighbor displacement (chips sliding apart to open a gap) is
 * deliberately rejected, and so is any in-flow spacer standing in for a gap:
 * chips are inline atoms flowing WITH the prose, so anything that takes
 * inline space reflows the sentence being edited, mid-drag, under the
 * pointer. Gap-opening is the convention for homogeneous chip LISTS; the
 * animated insertion caret is the convention for inline token editors
 * (ProseMirror's dropcursor, mail clients' recipient fields), and this is a
 * text editor.
 *
 * The ghost follows the OS-native drag convention and nothing fancier: it is
 * rigidly anchored at the grab point and moves 1:1 with the pointer — no
 * easing, no trailing offset, no lag. Seeing the caret through it is what
 * the translucency is for, exactly as a platform drag image handles it.
 */
export function attachChipDrag(
  root: HTMLElement,
  cb: {
    /** The drag became real: close any menu or picker. */
    onDragStart(): void;
    /** A drop landed and the order changed. */
    onMoved(chip: HTMLElement, message: string): void;
    onCancelled(): void;
  },
): () => void {
  const THRESHOLD = 5;

  let armed: { chip: HTMLElement; x: number; y: number } | null = null;
  let dragging: HTMLElement | null = null;
  let ghost: HTMLElement | null = null;
  let indicator: HTMLElement | null = null;
  let lastDrop: { units: number; noop: boolean } | null = null;
  let grab = { dx: 0, dy: 0 };
  let ghostSize = { w: 0, h: 0 };
  let raf = 0;

  /** The inline positioning contract: this element can never affect layout. */
  const fixInPlace = (el: HTMLElement) => {
    el.style.position = 'fixed';
    el.style.left = '0';
    el.style.top = '0';
    el.style.margin = '0';
    el.style.zIndex = 'var(--sc-z-popover)';
    el.style.pointerEvents = 'none';
  };

  const suppressNextClick = () => {
    const once = (e: MouseEvent) => {
      window.removeEventListener('click', once, true);
      // a click on a chip's X is unambiguous intent, never the stray
      // caret/picker click this suppressor exists to eat
      if ((e.target as HTMLElement).closest?.('[data-role="remove"]')) return;
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('click', once, true);
    // a drag that ends off the line produces no click at all; do not let the
    // suppressor eat an unrelated one later
    setTimeout(() => window.removeEventListener('click', once, true), 250);
  };

  const teardown = () => {
    ghost?.remove();
    indicator?.remove();
    ghost = null;
    indicator = null;
    lastDrop = null;
    dragging?.removeAttribute('data-drag-src');
    dragging = null;
    armed = null;
    root.removeAttribute('data-chip-drag');
    document.documentElement.style.cursor = '';
    cancelAnimationFrame(raf);
  };

  const cancel = () => {
    if (!dragging) return;
    teardown();
    suppressNextClick();
    cb.onCancelled();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-role="remove"]')) return;
    const chip = chipAt(target);
    if (!chip) return;
    // no preventDefault: a plain click must still place the caret and open
    // the picker exactly as before
    armed = { chip, x: e.clientX, y: e.clientY };
  };

  const promote = (e: PointerEvent) => {
    if (!armed) return;
    dragging = armed.chip;
    cb.onDragStart();
    window.getSelection()?.removeAllRanges();
    root.setAttribute('data-chip-drag', '');
    // the pointer keeps its grip where it landed on the chip, so the ghost
    // never jumps out from under the fingers at pickup. Measured BEFORE the
    // chip is marked as the source: that mark takes it out of the line, and
    // a box read after it has a zero rect at the origin.
    const r = dragging.getBoundingClientRect();
    grab = { dx: armed.x - r.left, dy: armed.y - r.top };
    armed = null;
    // the cursor rule on the line cannot follow a window-level drag
    document.documentElement.style.cursor = 'grabbing';

    ghost = dragging.cloneNode(true) as HTMLElement;
    ghost.querySelector('[data-role="remove"]')?.remove();
    ghost.className = `${dragging.className} sc-chip-ghost`;
    ghost.removeAttribute('data-drag-src');
    // a warned chip's tooltip must not ride along on the ghost
    ghost.removeAttribute('title');
    /*
     * The positioning CONTRACT is inline, not classed. The ghost wears the
     * chip's own classes for its skin, and any later .sc-token rule at equal
     * specificity can silently override a classed position — which is exactly
     * how a "fixed" ghost once became an in-flow box appended after #root,
     * grew the document, and summoned a global scrollbar mid-drag. Inline
     * style beats any single-class rule at any cascade position.
     */
    fixInPlace(ghost);
    ghost.style.width = `${r.width}px`;
    ghost.style.height = `${r.height}px`;
    // Chip metrics are em against the line's font; on <body> they would
    // resolve against the page font and the ghost would change size and
    // ellipsis point mid-air. Freeze the computed value inline — the same
    // contract as the positioning above.
    ghost.style.fontSize = getComputedStyle(dragging).fontSize;
    ghostSize = { w: r.width, h: r.height };
    document.body.appendChild(ghost);
    // Now the chip may leave the line: the ghost is the only thing left of it.
    dragging.setAttribute('data-drag-src', '');

    indicator = document.createElement('div');
    indicator.className = 'sc-drop-caret';
    fixInPlace(indicator);
    indicator.style.display = 'none';
    document.body.appendChild(indicator);
    follow(e);
  };

  const follow = (e: { clientX: number; clientY: number }) => {
    if (!ghost || !dragging) return;
    /*
     * OS-native drag behaviour, nothing invented: the ghost is rigidly
     * anchored at the grab point and moves 1:1 with the pointer. The caret
     * stays legible through the ghost's translucency, the way a platform
     * drag image handles the same overlap. Clamped to the viewport so the
     * no-scrollbar guarantee holds at the edges.
     */
    const cx = Math.min(Math.max(4, e.clientX - grab.dx), window.innerWidth - ghostSize.w - 4);
    const cy = Math.min(Math.max(4, e.clientY - grab.dy), window.innerHeight - ghostSize.h - 4);
    ghost.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
    const drop = dropUnitsAt(root, dragging, e.clientX, e.clientY);
    lastDrop = drop;
    if (!indicator) return;
    const rect = drop && !drop.noop ? rectAtUnits(root, drop.units) : null;
    if (!rect) {
      indicator.style.display = 'none';
      return;
    }
    indicator.style.display = '';
    indicator.style.transform = `translate3d(${rect.left - 1.5}px, ${rect.top - 2}px, 0)`;
    indicator.style.height = `${rect.height + 4}px`;
  };

  const onPointerMove = (e: PointerEvent) => {
    if (armed) {
      if (Math.hypot(e.clientX - armed.x, e.clientY - armed.y) < THRESHOLD) return;
      promote(e);
      return;
    }
    if (!dragging) return;
    e.preventDefault();
    cancelAnimationFrame(raf);
    const { clientX, clientY } = e;
    raf = requestAnimationFrame(() => follow({ clientX, clientY }));
  };

  const onPointerUp = (e: PointerEvent) => {
    if (armed) {
      armed = null; // it was a click; the line handles it untouched
      return;
    }
    if (!dragging) return;
    const chip = dragging;
    const drop = dropUnitsAt(root, chip, e.clientX, e.clientY) ?? lastDrop;
    teardown();
    suppressNextClick();
    if (drop && !drop.noop && moveChipToUnits(root, chip, drop.units)) {
      caretBeside(root, chip, 'after');
      cb.onMoved(chip, moveAnnouncement(root, chip));
      return;
    }
    cb.onCancelled();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && dragging) {
      e.stopPropagation();
      cancel();
    }
  };

  const onDragStart = (e: DragEvent) => {
    // kill Chromium/WebKit's own node drag of a contenteditable=false atom;
    // file drops carry Files in dataTransfer and never originate on a chip
    if (chipAt(e.target)) e.preventDefault();
  };

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('dragstart', onDragStart);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
  window.addEventListener('keydown', onKeyDown, true);

  return () => {
    teardown();
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('dragstart', onDragStart);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('keydown', onKeyDown, true);
  };
}

/** Where a unit position sits on screen, for the insertion indicator. */
function rectAtUnits(root: HTMLElement, units: number): DOMRect | null {
  let n = 0;
  const kids = Array.from(root.childNodes);
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    const len = c.nodeType === Node.TEXT_NODE ? (c.textContent ?? '').length : 1;
    if (units <= n + len) {
      if (c.nodeType !== Node.TEXT_NODE) {
        // a chip edge: the element's own box is the honest geometry
        const r = (c as HTMLElement).getBoundingClientRect();
        return new DOMRect(units === n ? r.left : r.right, r.top, 0, r.height);
      }
      const range = document.createRange();
      range.setStart(c, Math.max(0, Math.min(units - n, len)));
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return rect.height ? rect : null;
    }
    n += len;
  }
  const last = root.lastElementChild ?? root;
  const r = last.getBoundingClientRect();
  return new DOMRect(r.right, r.top, 0, r.height || 18);
}
