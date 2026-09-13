import type { InsertSigil } from './ingredientOptions.js';

export const INSERT_MENU_ID = 'sc-insert-menu';

export function composingEvent(e: {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
}): boolean {
  return Boolean(e.nativeEvent?.isComposing ?? e.isComposing) || e.keyCode === 229;
}

export function insertLabel(sigil: InsertSigil | undefined): string {
  if (sigil === '/') return 'Scenes';
  if (sigil === '@') return 'Presenters';
  if (sigil === '#') return 'Colors';
  return 'Products';
}

export function emptyInsertCopy(sigil: InsertSigil | undefined): string {
  if (sigil === '/') return 'No matching scenes';
  if (sigil === '#') return 'No matching colours';
  if (sigil === '@') return 'No matching presenters';
  return 'No matching products';
}

/**
 * Whether an Enter belongs to the brief and should fire the shot.
 *
 * Two things want Enter: the insert menu, to accept the highlighted row, and
 * the brief, to generate. Asking only whether the menu is open is a race.
 * The menu takes the key from a window capture listener and accepting a row
 * closes it inside that same event, so under load the menu state has already
 * gone by the time the brief's own handler runs, and the shot fires on the
 * keystroke that was meant to place a chip. Whoever took it marked the event,
 * so the mark is the second half of the answer.
 */
export function enterSubmits({ menuOpen, handled }: { menuOpen: boolean; handled: boolean }): boolean {
  return !menuOpen && !handled;
}

/**
 * After an input event: stay open only when the caret is still in a typed
 * sigil. A paste that happens to contain `@` or `#` is not a trigger.
 */
export function menuFromInput(
  live: { sigil: InsertSigil; query: string } | null,
  pasted: boolean,
): { open: false } | { open: true; sigil: InsertSigil; query: string } {
  if (pasted || !live) return { open: false };
  return { open: true, sigil: live.sigil, query: live.query };
}

/** First query term, same colour, slightly heavier. Nothing if it misses. */
export function splitMatch(label: string, query: string): { text: string; hit: boolean }[] {
  const term = query.trim().split(/\s+/).filter(Boolean)[0];
  if (!term) return [{ text: label, hit: false }];
  const i = label.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
  if (i < 0) return [{ text: label, hit: false }];
  const end = i + term.length;
  return [
    ...(i > 0 ? [{ text: label.slice(0, i), hit: false }] : []),
    { text: label.slice(i, end), hit: true },
    ...(end < label.length ? [{ text: label.slice(end), hit: false }] : []),
  ];
}

type ScrollHost = { contains(node: unknown): boolean };
type Rect = { top: number; bottom: number; left: number; right: number };

/** Caret as an offset on the brief, so a later line box can rebuild it. */
export type CaretOnLine = { x: number; y: number; w: number; h: number };

export function copyRect(r: Rect): Rect {
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
}

export function caretOnLine(caret: Rect, line: Rect): CaretOnLine {
  return {
    x: caret.left - line.left,
    y: caret.top - line.top,
    w: caret.right - caret.left,
    h: caret.bottom - caret.top,
  };
}

export function caretFromLine(line: Rect, at: CaretOnLine): Rect {
  return {
    left: line.left + at.x,
    top: line.top + at.y,
    right: line.left + at.x + at.w,
    bottom: line.top + at.y + at.h,
  };
}

/**
 * Which caret the insert menu should follow.
 *
 * The search field takes focus on purpose. A live range then sits in the
 * input (or is gone), and placing off that lie — or off the whole brief —
 * is the fly-away. A snapshot taken while the caret was still in the line
 * stays good; `held` is that field having focus.
 */
export function pickInsertCaret(live: Rect | null, last: Rect | null, held: boolean): Rect | null {
  if (held) return last;
  if (live) return live;
  return last;
}

/**
 * Whether a scroll event should re-place the insert menu.
 *
 * The menu itself scrolls when a page lands. That event hits the window
 * capture listener that follows the caret — treating it as a new place is
 * what made the box jump on every load-more.
 */
export function placeOnScroll(target: unknown, menu: ScrollHost | null): boolean {
  if (!menu || target == null) return true;
  if (target === menu) return false;
  return !menu.contains(target);
}

export function sameInsertPos<
  T extends { left: number; top: number; width: number; maxHeight: number; side: string; shell: string },
>(a: T | null, b: T | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.maxHeight === b.maxHeight &&
    a.side === b.side &&
    a.shell === b.shell
  );
}

/**
 * How tall the insert menu wants to be.
 *
 * `offsetHeight` is the painted box, which is already capped by the last
 * `maxHeight`. After a miss that cap is ~80px, so measuring it again can
 * never grow when `/q` becomes `/qa`. The list's scroll height is the
 * content; chrome is the search field and padding around it.
 */
export function neededInsertHeight(chrome: number, listScroll: number, cap: number): number {
  return Math.min(cap, Math.max(0, chrome) + Math.max(0, listScroll));
}

/** One ask per already-drawn page, so ArrowDown and the sentinel cannot double-fire. */
export function shouldAskMore(askedAtLength: number, visible: number, remaining: number): boolean {
  return remaining > 0 && visible > 0 && askedAtLength !== visible;
}

/** Move a row inside the menu without asking the window to scroll. */
export function scrollChildIntoNearest(root: HTMLElement, child: HTMLElement): void {
  const r = child.getBoundingClientRect();
  const b = root.getBoundingClientRect();
  if (r.bottom > b.bottom) root.scrollTop += r.bottom - b.bottom;
  else if (r.top < b.top) root.scrollTop -= b.top - r.top;
}
