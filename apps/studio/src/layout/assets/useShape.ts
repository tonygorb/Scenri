export type Shape = 'compact' | 'open';

/**
 * What a section is doing while the column is in whatever state it is in.
 *
 * `idle` — nothing is open anywhere, so every section shows its quick row and
 * the whole shelf is readable at a glance. `open` — this one is being used, so
 * it takes the height. `collapsed` — a sibling is open, so this one gives its
 * row back and waits as a header. `result` — a search is live, so every
 * section shows what it found and the rail scrolls through the answers.
 *
 * That third mode is the point. Height in a 320px column is the scarce thing:
 * four other quick rows are 280px that the section you are actually working in
 * could be using, and they are not being looked at while you work in it.
 */
export type SectionMode = 'idle' | 'open' | 'collapsed' | 'result';

/** The shape a mode draws: the quick row, or the named grid. */
export function shapeOf(mode: SectionMode): Shape {
  return mode === 'open' || mode === 'result' ? 'open' : 'compact';
}
