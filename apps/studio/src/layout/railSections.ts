import type { SentenceToken } from '../composer/line.js';

/**
 * The pure decisions behind the Create rail's sections — no React, no DOM, so
 * `test/railSections.test.ts` can cover them directly. Same split the library
 * pages already make with `library/libraryRules.ts`.
 */

/**
 * The quick row every section shows when it is closed: four square thumbnails,
 * no labels, one row. Closed is the default and it is never empty — a heading
 * with nothing under it is a section you have to open to find out whether it
 * was worth opening.
 */
export const RAIL_COMPACT = 4;

/**
 * Opened out: what a section draws before you ask it for more.
 *
 * Sized to fill the height an open section claims rather than to be a tidy
 * number — eight rows of three covers the pane on a tall window and simply
 * scrolls inside it on a short one. Drawing fewer left a hole under the last
 * row, which reads as the section having taken space it had no use for.
 */
export const RAIL_EXPANDED = 24;

/**
 * How many more the "more" tile adds each time.
 *
 * It adds them here rather than navigating anywhere. This is a sidebar: asking
 * to see more of a shelf should give you more of the shelf, not throw the page
 * away and land you somewhere else mid-thought. The full library pages are a
 * click away in the nav for when browsing really is the job.
 */
export const RAIL_BATCH = 24;

/** What the brief currently holds, by kind. Scenes are singular; the rest are not. */
export interface AttachedIds {
  product: string[];
  presenter: string[];
  /** At most one — `BriefInput.place` swaps a template rather than appending. */
  scene: string | null;
}

export const NO_ATTACHMENTS: AttachedIds = { product: [], presenter: [], scene: null };

/** Which assets a sentence has attached, in the order they appear. */
export function attachedIdsOf(tokens: readonly SentenceToken[]): AttachedIds {
  const product: string[] = [];
  const presenter: string[] = [];
  let scene: string | null = null;
  for (const t of tokens) {
    if (t.t === 'product') {
      if (!product.includes(t.id)) product.push(t.id);
    } else if (t.t === 'character') {
      if (!presenter.includes(t.id)) presenter.push(t.id);
    } else if (t.t === 'template') {
      scene = t.id;
    }
  }
  return { product, presenter, scene };
}

/**
 * A comparable stamp of the above.
 *
 * The rail only cares that the *set of attached assets* changed. A sentence
 * object is new on every keystroke, so an effect watching it would republish
 * (and re-render the rail) on every character typed into the brief.
 */
export function attachedIdsKey(a: AttachedIds): string {
  return `${a.product.join(',')}|${a.presenter.join(',')}|${a.scene ?? ''}`;
}

export interface RailSlice<T> {
  visible: T[];
  /** How many matched but are not drawn. Zero means no "more" tile. */
  more: number;
}

/**
 * The tiles one section draws: what is attached, then the ranked rest.
 *
 * Attached items are lifted rather than left where they rank, so an asset you
 * just put in the brief is always the one you can see and un-tick — a tick
 * that only appears when the item happened to land in the top five would be a
 * selection state you cannot trust. Array#sort is stable, so the incoming rank
 * survives inside both halves.
 */
export function railSlice<T extends { id: string }>(
  items: readonly T[],
  attached: ReadonlySet<string>,
  preview: number,
): RailSlice<T> {
  const lifted = attached.size
    ? [...items].sort((a, b) => Number(attached.has(b.id)) - Number(attached.has(a.id)))
    : items;
  const visible = lifted.slice(0, preview);
  return { visible, more: Math.max(0, items.length - visible.length) };
}
