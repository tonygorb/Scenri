import type { BriefToken } from './composer/line.js';

/**
 * The one reading order for a shot's context, everywhere it is shown:
 * product, presenter, scene, custom references, brand mark, colors.
 *
 * This is PRESENTATION order — what a person scans — and it deliberately
 * differs from the engine budget's survival priority (attachmentBudget.ts
 * ranks brand above reference because a logo is closer to identity than a
 * mood image). Reading order answers "what is this shot made of", budget
 * order answers "what boards a full flight first"; conflating them once made
 * the chips reorder whenever the cap bit.
 */
export const CONTEXT_KIND_ORDER = ['product', 'presenter', 'scene', 'ref', 'mark', 'color'] as const;

export type ContextKind = (typeof CONTEXT_KIND_ORDER)[number];

/** A token's display kind, or null for the kinds that are not context (text, format). */
export function contextKindOf(t: BriefToken): ContextKind | null {
  switch (t.t) {
    case 'product':
      return 'product';
    case 'character':
      return 'presenter';
    case 'template':
      return 'scene';
    case 'ref':
      return 'ref';
    case 'mark':
      return 'mark';
    case 'color':
      return 'color';
    default:
      return null;
  }
}

/** Sort comparator over anything that knows its display kind. Stable ties. */
export function byContextOrder<T extends { kind: string }>(a: T, b: T): number {
  const rank = (k: string) => {
    const i = (CONTEXT_KIND_ORDER as readonly string[]).indexOf(k);
    return i === -1 ? CONTEXT_KIND_ORDER.length : i;
  };
  return rank(a.kind) - rank(b.kind);
}
