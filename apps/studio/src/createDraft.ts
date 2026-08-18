/**
 * What someone typed into the create dialog but has not sent yet, kept per
 * brand and per kind.
 *
 * This is what lets the dialog close without asking. A confirm ("discard your
 * work?") is the wrong answer to a problem you can just not have: nothing is
 * lost, so there is nothing to warn about. It is also the fix for Try again,
 * which used to reopen a blank form and ask the person to re-upload the photos
 * the failed build had already read.
 *
 * Sibling of draft.ts and held to the same rules: no React import, so the
 * bookkeeping half — the half that goes wrong in ways nobody notices for a
 * week — sits where a test can reach it. (vitest only globs `.ts` under test/.)
 */

export type CreateKind = 'product' | 'presenter' | 'scene';

export interface AssetDraft {
  v: 1;
  brandId: string;
  kind: CreateKind;
  updatedAt: string;
  name: string;
  /** Presenter's note, scene's description. Unused by product. */
  instruction: string;
  /** Categories the new asset files under. One list, three forms. */
  facets: string[];
  /**
   * Content hashes, never File objects. Uploading happens as files are picked,
   * which is what makes this draft storable at all: bytes cannot go in
   * localStorage, and a 32-hex hash already outlives the tab on the server.
   */
  imageHashes: string[];
  /** Product only: a half-typed store URL is work too. */
  importUrl: string;
  /**
   * The build this draft was last submitted as, for presenter and scene.
   * Null means it was never sent. See `shouldHydrate` — this is the whole
   * difference between "you are making a second one" and "the first one failed".
   */
  pending: string | null;
}

/** Same window as the composer draft: a month-old unsent form is not a draft. */
const STALE_MS = 30 * 24 * 60 * 60 * 1000;

/** brandId, not slug — renaming a brand must not orphan what you were typing. */
export const assetDraftKey = (brandId: string, kind: CreateKind): string => `scenri:new-${brandId}-${kind}`;

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

export interface DraftFields {
  name?: string;
  instruction?: string;
  facets?: string[];
  imageHashes?: string[];
  importUrl?: string;
}

/**
 * An empty form is not worth a write. Any one field counts: a name alone is a
 * decision someone made, and so is a single uploaded photo.
 */
export function isNonTrivial(d: DraftFields): boolean {
  return (
    !!d.name?.trim() ||
    !!d.instruction?.trim() ||
    !!d.importUrl?.trim() ||
    (d.facets ?? []).length > 0 ||
    (d.imageHashes ?? []).length > 0
  );
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * The stored draft, or null if there is none, it failed to parse, it belongs to
 * a different brand or kind, it predates this shape, or it is stale. A draft
 * rejected for any of those reasons is also removed — leaving a corrupt key in
 * place means paying the same parse on every open forever.
 */
export function loadAssetDraft(brandId: string, kind: CreateKind): AssetDraft | null {
  const key = assetDraftKey(brandId, kind);
  const raw = read(key);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    remove(key);
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    remove(key);
    return null;
  }
  const d = parsed as Partial<AssetDraft>;
  if (d.v !== 1 || d.brandId !== brandId || d.kind !== kind) {
    remove(key);
    return null;
  }
  const age = Date.now() - Date.parse(d.updatedAt ?? '');
  if (!Number.isFinite(age) || age > STALE_MS) {
    remove(key);
    return null;
  }
  return {
    v: 1,
    brandId,
    kind,
    updatedAt: d.updatedAt as string,
    name: typeof d.name === 'string' ? d.name : '',
    instruction: typeof d.instruction === 'string' ? d.instruction : '',
    facets: strings(d.facets),
    imageHashes: strings(d.imageHashes),
    importUrl: typeof d.importUrl === 'string' ? d.importUrl : '',
    pending: typeof d.pending === 'string' ? d.pending : null,
  };
}

/** The caller has already checked `isNonTrivial`; this is a dumb writer. */
export function saveAssetDraft(
  brandId: string,
  kind: CreateKind,
  data: DraftFields & { pending?: string | null },
): void {
  const draft: AssetDraft = {
    v: 1,
    brandId,
    kind,
    updatedAt: new Date().toISOString(),
    name: data.name ?? '',
    instruction: data.instruction ?? '',
    facets: data.facets ?? [],
    imageHashes: data.imageHashes ?? [],
    importUrl: data.importUrl ?? '',
    pending: data.pending ?? null,
  };
  write(assetDraftKey(brandId, kind), JSON.stringify(draft));
}

export function clearAssetDraft(brandId: string, kind: CreateKind): void {
  remove(assetDraftKey(brandId, kind));
}

/**
 * The state of the build a draft was submitted as, as far as the caller knows.
 * `unknown` covers the honest case where the server has forgotten it — the
 * registry is in memory, so a restart loses builds — and is treated as failure,
 * because a person who cannot see their build finish should get their inputs
 * back rather than an empty form.
 */
export type PendingState = 'running' | 'done' | 'failed' | 'cancelled' | 'unknown';

/**
 * Whether to put a stored draft back into a freshly opened form.
 *
 * Never sent → yes, obviously. Sent and it went badly → yes, and this is the
 * whole point: Try again reopens with the photos and the words still in it.
 * Sent and it is running or already landed → no. That form is finished; you
 * are making a second presenter, not editing the first.
 */
export function shouldHydrate(draft: AssetDraft | null, pendingState: PendingState | null): boolean {
  if (!draft) return false;
  if (draft.pending === null) return true;
  const state = pendingState ?? 'unknown';
  return state === 'failed' || state === 'cancelled' || state === 'unknown';
}
