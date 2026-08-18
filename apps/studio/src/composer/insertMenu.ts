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
