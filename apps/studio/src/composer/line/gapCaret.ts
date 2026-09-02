import { isChip } from './invariants.js';

// ---------------------------------------------------------------- the caret beside a chip

/**
 * The caret drawn at a line position beside a chip.
 *
 * Between two chips, before the first or after the last, the caret sits on the
 * line itself, and no browser paints that well: Chromium puts the bar against
 * one chip's edge and stretches it to the line box, taller than the pills it
 * sits between. Every editor with inline atoms draws its own caret there (a
 * gap cursor) and this is that: while the caret is on the line beside a chip,
 * the browser's is hidden and a bar the height of the pill is drawn in the
 * middle of the gap, or one margin's width off a lone chip's edge. In text the
 * browser's caret is the caret, untouched.
 *
 * Fine pointers only. A touch caret brings its own handle and loupe, and hiding
 * it would take those away.
 */
export function attachGapCaret(root: HTMLElement | null): () => void {
  if (!root || typeof window === 'undefined') return () => {};
  if (!window.matchMedia('(pointer: fine)').matches) return () => {};

  let bar: HTMLDivElement | null = null;
  const hide = () => {
    root.style.caretColor = '';
    if (bar) bar.hidden = true;
  };
  const place = () => {
    const at = gapCaretRect(root);
    if (!at || document.activeElement !== root) return hide();
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'sc-gap-caret';
      document.body.appendChild(bar);
    }
    bar.style.transform = `translate3d(${at.x - 0.5}px, ${at.top}px, 0)`;
    bar.style.height = `${at.height}px`;
    bar.style.background = getComputedStyle(root).color;
    // a keystroke resets a native caret's blink; so does this
    bar.style.animation = 'none';
    void bar.offsetWidth;
    bar.style.animation = '';
    bar.hidden = false;
    root.style.caretColor = 'transparent';
  };

  document.addEventListener('selectionchange', place);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  root.addEventListener('focusin', place);
  root.addEventListener('focusout', hide);
  return () => {
    document.removeEventListener('selectionchange', place);
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
    root.removeEventListener('focusin', place);
    root.removeEventListener('focusout', hide);
    bar?.remove();
    root.style.caretColor = '';
  };
}

/**
 * Where a caret on the line beside a chip should be drawn, or null when the
 * caret is anywhere else: in text, inside a chip, or a selection.
 */
export function gapCaretRect(root: HTMLElement): { x: number; top: number; height: number } | null {
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.getRangeAt(0).collapsed) return null;
  const r = sel.getRangeAt(0);
  if (r.startContainer !== root) return null;
  const before = root.childNodes[r.startOffset - 1] ?? null;
  const after = root.childNodes[r.startOffset] ?? null;
  const b = isChip(before) ? (before as HTMLElement).getBoundingClientRect() : null;
  const a = isChip(after) ? (after as HTMLElement).getBoundingClientRect() : null;
  if (!b && !a) return null;
  if (b && a && b.bottom > a.top && a.bottom > b.top) {
    // two chips on one row: the middle of their gap, as tall as the taller pill
    const top = Math.min(b.top, a.top);
    return { x: (b.right + a.left) / 2, top, height: Math.max(b.bottom, a.bottom) - top };
  }
  // beside one chip: one margin's width off its edge, the pill's own height
  const chip = (b ? before : after) as HTMLElement;
  const margin = Number.parseFloat(getComputedStyle(chip).marginInlineStart) || 0;
  const rect = (b ?? a) as DOMRect;
  return { x: b ? rect.right + margin : rect.left - margin, top: rect.top, height: rect.height };
}
