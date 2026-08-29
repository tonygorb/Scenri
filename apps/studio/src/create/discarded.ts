import type { CreateKind } from '../createDraft.js';
import type { AssetFields } from './useAssetFields.js';

/**
 * The last create form that was abandoned with something in it, held in memory
 * so one Undo can put it back.
 *
 * Closing a creation now ends it, which is what makes a new scene feel new. The
 * cost of that is the accident: an Escape aimed at something else, a backdrop
 * click, and four uploaded photographs are gone. A confirm ("discard your
 * work?") buys that back by taxing every deliberate close, which is the common
 * one — so the way back is offered after the fact instead, in the toast that
 * says what happened.
 *
 * Memory, never storage, and that is the whole point: this must not become the
 * thing it replaced. It dies with the page, it holds exactly one attempt, and
 * taking it consumes it. A second abandonment replaces the first, because one
 * way back from the last accident is the offer being made — not a history.
 */

let slot: { key: string; fields: AssetFields } | null = null;

const keyOf = (brandId: string, kind: CreateKind) => `${brandId}:${kind}`;

export function stashDiscarded(brandId: string, kind: CreateKind, fields: AssetFields): void {
  slot = { key: keyOf(brandId, kind), fields };
}

/** The stashed attempt, if it is this form's, and only once. */
export function takeDiscarded(brandId: string, kind: CreateKind): AssetFields | null {
  if (!slot || slot.key !== keyOf(brandId, kind)) return null;
  const { fields } = slot;
  slot = null;
  return fields;
}

/** The offer is over: the toast went, or the attempt was made for real. */
export function dropDiscarded(): void {
  slot = null;
}
