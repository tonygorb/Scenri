import type { SentenceToken } from './composer/line.js';

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
  branchId: string | null;
  setSlug: string | null;
}

const STALE_MS = 30 * 24 * 60 * 60 * 1000;

export const draftKey = (brandId: string): string => `scenri:draft-${brandId}`;

/** Private-mode browsers throw on localStorage; a missing draft is not an error. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the draft is nice to have, not worth an exception */
  }
}
function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to clean up if we cannot reach it anyway */
  }
}

/** A blank composer is not worth a write: nothing typed, no attachment, no branch target. */
export function isNonTrivial(
  tokens: SentenceToken[],
  tplFields: Record<string, string>,
  branchId: string | null,
): boolean {
  return (
    tokens.some((t) => (t.t === 'text' ? !!t.v.trim() : true)) ||
    Object.values(tplFields).some((v) => !!v.trim()) ||
    !!branchId
  );
}

/**
 * The stored draft for a brand, or null if there is none, it failed to parse,
 * it belongs to a different brand, it predates this shape, or it is stale.
 * Never validates branchId against a node list: this module has no access to
 * one, and the caller already has an existing "target no longer resolves"
 * path to fall back on.
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
  const d = parsed as Partial<PersistedDraft>;
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
    branchId: d.branchId ?? null,
    setSlug: d.setSlug ?? null,
  };
}

/** The caller has already checked `isNonTrivial`; this is a dumb writer. */
export function saveDraft(
  brandId: string,
  data: {
    tokens: SentenceToken[];
    tplFields: Record<string, string>;
    branchId: string | null;
    setSlug?: string | null;
  },
): void {
  const draft: PersistedDraft = {
    v: 1,
    brandId,
    updatedAt: new Date().toISOString(),
    tokens: data.tokens,
    tplFields: data.tplFields,
    branchId: data.branchId,
    setSlug: data.setSlug ?? null,
  };
  write(draftKey(brandId), JSON.stringify(draft));
}

export function clearDraft(brandId: string): void {
  remove(draftKey(brandId));
}
