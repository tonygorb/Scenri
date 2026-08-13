/**
 * The pure decisions behind the Create feed's search and sort — kept free of
 * React/DOM so `test/feedRules.test.ts` can cover the actual logic directly,
 * the same split `layout/library/libraryRules.ts` makes for the library pages.
 */

import type { TreeNode } from './api.js';
import type { BriefToken } from './composer/line.js';
import { matchesQuery } from './layout/library/libraryRules.js';

export type FeedSort = 'newest' | 'oldest' | 'cost' | 'keepers';

export const FEED_SORTS: ReadonlyArray<{ id: FeedSort; label: string }> = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'cost', label: 'Highest cost' },
  { id: 'keepers', label: 'Keepers first' },
];

/** Guards a pref read: localStorage may hold a value from a future or past build. */
export function isFeedSort(v: unknown): v is FeedSort {
  return FEED_SORTS.some((s) => s.id === v);
}

/** Newest first — the ordering the feed has always used. */
export const byNewest = (a: TreeNode, b: TreeNode): number => b.createdAt.localeCompare(a.createdAt);

/**
 * How a haystack builder turns brief-token ids into searchable display names.
 * A resolver returns null for an id it no longer knows (deleted catalog
 * entry), and that token simply contributes nothing.
 */
export interface TokenNames {
  product(id: string): string | null;
  person(id: string): string | null;
  scene(id: string): string | null;
}

/**
 * Everything searchable about a shot, joined into one string: the compiled
 * prompt, the display names behind its brief tokens, template field values,
 * color names/hexes, and the engine's display name. Text tokens are skipped —
 * their words are already inside the compiled prompt.
 */
export function shotSearchText(n: TreeNode, names: TokenNames, engineName?: string | null): string {
  const parts: string[] = [n.prompt];
  const brief = n.brief;
  if (brief) {
    const tokens = (brief.tokens ?? []) as BriefToken[];
    let sawTemplate = false;
    for (const t of tokens) {
      switch (t.t) {
        case 'product':
          push(parts, names.product(t.id));
          break;
        case 'character':
          push(parts, names.person(t.id));
          break;
        case 'template':
          sawTemplate = true;
          push(parts, names.scene(t.id));
          break;
        case 'color':
          push(parts, t.name);
          push(parts, t.hex);
          break;
        default:
          break;
      }
    }
    // A legacy brief carries a bare templateId with no token for it yet.
    if (brief.templateId && !sawTemplate) push(parts, names.scene(brief.templateId));
    for (const v of Object.values(brief.templateFields ?? {})) push(parts, v);
  }
  push(parts, engineName);
  return parts.join('\n');
}

function push(parts: string[], v: string | null | undefined): void {
  if (v) parts.push(v);
}

/**
 * Narrow the feed to shots matching `q`. Matching semantics (AND across
 * terms, accent folding, trailing-plural stemming) come from `matchesQuery`.
 * An empty/whitespace query returns the input array itself, so memo consumers
 * keep referential equality when no search is active.
 */
export function filterFeed(nodes: TreeNode[], q: string, textFor: (n: TreeNode) => string): TreeNode[] {
  if (!q.trim()) return nodes;
  return nodes.filter((n) => matchesQuery(textFor(n), q));
}

/**
 * A full ordering, never a nudge of the input: every sort ends in the newest
 * tiebreak so the result is stable and independent of input order. Never
 * mutates. An unknown sort falls back to newest.
 */
export function sortFeed(nodes: TreeNode[], sort: FeedSort): TreeNode[] {
  const out = [...nodes];
  switch (sort) {
    case 'oldest':
      return out.sort((a, b) => byNewest(b, a));
    case 'cost':
      return out.sort((a, b) => b.costUsd - a.costUsd || byNewest(a, b));
    case 'keepers':
      return out.sort((a, b) => Number(b.kept) - Number(a.kept) || byNewest(a, b));
    default:
      return out.sort(byNewest);
  }
}
