import type { SentenceToken } from './composer/line.js';
import { STALE_MS, local } from './storage.js';

/**
 * The composer's in-progress brief, kept per brand so a typed-but-unsent shot
 * survives a navigation, a brand switch, or a closed tab. None of this imports
 * React, same reason as tasks.ts: the bookkeeping is the half that can be
 * wrong in ways nobody notices for a week, so it lives where a test can reach
 * it. (vitest only globs `.ts` under test/.)
 */

export interface PersistedDraft {
  v: 1;
  brandId: string;
  updatedAt: string;
  tokens: SentenceToken[];
  tplFields: Record<string, string>;
  setSlug: string | null;
}

export const draftKey = (brandId: string): string => `scenri:draft-${brandId}`;

/*
 * The local lane, where createDraft.ts takes the session one, and the
 * difference is the point: a brief someone is part way through writing is work
 * to come back to tomorrow, not one creation attempt in flight.
 */
const read = (key: string): string | null => local.get(key);
const write = (key: string, value: string): void => local.set(key, value);
const remove = (key: string): void => local.del(key);

/**
 * A blank composer is not worth a write: nothing typed, no attachment.
 *
 * A scene chip on its own does not count either, and that exclusion is the point rather than an
 * oversight. Every other chip is something the user went and attached; a scene arrives on its own
 * from a link — `?scene=` from the Scenes page, from Home's compose card — so a brief that is one
 * scene and nothing else is a seed that was never built on, not work to come back to. Storing it
 * meant a scene nobody chose was restored silently on every later cold load, for thirty days.
 *
 * A refine target does not count at all, and is not even a field here any more. The target lives
 * in the URL (`?branch=`) for exactly as long as that conversation is open; persisting it meant a
 * month-old refine session hijacked every later fresh Create into edit mode, across tabs. And an
 * instruction typed FOR a target ("make it warmer") restored WITHOUT its target says the opposite
 * of what was typed, so a stored draft that carries one is discarded whole on load. Refining any
 * shot again later needs none of this: the shot itself, and the identity its thread inherits, are
 * in the database forever.
 *
 * Read as well as write goes through here, so a draft already storing a bare scene is dropped the
 * next time it is loaded, and a real half-written brief is untouched.
 */
export function isNonTrivial(tokens: SentenceToken[], tplFields: Record<string, string>): boolean {
  return (
    tokens.some((t) => (t.t === 'text' ? !!t.v.trim() : t.t !== 'template')) ||
    Object.values(tplFields).some((v) => !!v.trim())
  );
}

/**
 * The stored draft for a brand, or null if there is none, it failed to parse,
 * it belongs to a different brand, it predates this shape, or it is stale.
 */
export function loadDraft(brandId: string): PersistedDraft | null {
  const raw = read(draftKey(brandId));
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const d = parsed as Partial<PersistedDraft> & { branchId?: string | null };
  if (
    d.v !== 1 ||
    d.brandId !== brandId ||
    !Array.isArray(d.tokens) ||
    typeof d.tplFields !== 'object' ||
    !d.tplFields
  ) {
    remove(draftKey(brandId));
    return null;
  }
  // A draft written before refine targets stopped being persisted. Its text
  // was typed for that target, so neither half survives alone — see the
  // isNonTrivial comment. One-time, on the first load after the update.
  if (d.branchId) {
    remove(draftKey(brandId));
    return null;
  }
  const age = Date.now() - Date.parse(d.updatedAt ?? '');
  if (!Number.isFinite(age) || age > STALE_MS) {
    remove(draftKey(brandId));
    return null;
  }
  return {
    v: 1,
    brandId,
    updatedAt: d.updatedAt as string,
    tokens: d.tokens as SentenceToken[],
    tplFields: d.tplFields as Record<string, string>,
    setSlug: d.setSlug ?? null,
  };
}

/** The caller has already checked `isNonTrivial`; this is a dumb writer. */
export function saveDraft(
  brandId: string,
  data: {
    tokens: SentenceToken[];
    tplFields: Record<string, string>;
    setSlug?: string | null;
  },
): void {
  const draft: PersistedDraft = {
    v: 1,
    brandId,
    updatedAt: new Date().toISOString(),
    tokens: data.tokens,
    tplFields: data.tplFields,
    setSlug: data.setSlug ?? null,
  };
  write(draftKey(brandId), JSON.stringify(draft));
}

export function clearDraft(brandId: string): void {
  remove(draftKey(brandId));
}
