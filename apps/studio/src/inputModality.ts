/**
 * Which hand moved last: the keyboard or a pointer (mouse, pen, touch).
 *
 * Browsers decide `:focus-visible` on their own heuristics, and one of them
 * lights the ring when a script moves focus. Radix moves focus back to a
 * menu's trigger every time it closes, so a menu opened and closed with the
 * mouse used to leave a keyboard ring (and a focus tooltip) on its trigger.
 * The answer is not to drop that focus, which keyboard and screen reader users
 * rely on, but to say which hand is in use: `html[data-input]` is `keyboard`
 * or `pointer`, and the focus doctrine in foundations/interaction.css rings a
 * control only when it is not `pointer`. Before any input it is unset, and
 * rings show.
 */
export type InputModality = 'keyboard' | 'pointer';

const MODIFIERS = new Set([
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'CapsLock',
  'Fn',
  'FnLock',
  'Hyper',
  'Super',
  'OS',
]);

let current: InputModality | null = null;

function note(next: InputModality) {
  if (current === next) return;
  current = next;
  document.documentElement.dataset.input = next;
}

/** Listens for the rest of the page's life, ahead of every other listener. Returns the undo, for tests. */
export function installInputModality(): () => void {
  const onKey = (e: KeyboardEvent) => {
    // A lone modifier (Cmd before a click) and IME composition say nothing about focus.
    if (e.isComposing || e.key === 'Unidentified' || MODIFIERS.has(e.key)) return;
    note('keyboard');
  };
  const onPointer = () => note('pointer');
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onPointer, true);
  return () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onPointer, true);
  };
}

export function inputModality(): InputModality | null {
  return current;
}

/** Focus the keyboard put here: what may open a preview or a peek the way a hover would. */
export function keyboardFocus(el: Element): boolean {
  return current !== 'pointer' && el.matches(':focus-visible');
}

/** Tests only: a fresh page. */
export function resetInputModalityForTests(): void {
  current = null;
  delete document.documentElement.dataset.input;
}
