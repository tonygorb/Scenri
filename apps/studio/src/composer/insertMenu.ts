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
  if (sigil === '@') return 'Presenters';
  if (sigil === '#') return 'Scenes';
  return 'Products';
}

export function emptyInsertCopy(sigil: InsertSigil | undefined): string {
  if (sigil === '#') return 'No matching scenes';
  if (sigil === '@') return 'No matching presenters';
  return 'No matching products';
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
