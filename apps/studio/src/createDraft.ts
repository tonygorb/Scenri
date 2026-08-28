/**
 * What someone typed into the create dialog but has not sent yet, kept per
 * brand and per kind, for as long as the tab lives.
 *
 * This is what lets the dialog close without asking. A confirm ("discard your
 * work?") is the wrong answer to a problem you can just not have: step away
 * mid-thought and it is all still there when you come back. It is also the fix
 * for Try again, which used to reopen a blank form and ask the person to
 * re-upload the photos the failed build had already read.
 *
 * It lives in sessionStorage, and that is the whole lifetime rule: one creation
 * attempt owns one draft, and the attempt ends when the asset exists or when
 * the tab does. Photographs from last week quietly refilling a form headed
 * "New presenter" is how somebody casts a presenter from the previous
 * presenter's face. UpdateCenter reached the same conclusion about its own
 * dismissal, for the same reason.
 *
 * Sibling of draft.ts, which stays in localStorage on purpose: a brief you are
 * still writing is work to come back to, not an attempt in flight.
 *
 * Held to draft.ts's other rule too: no React import, so the bookkeeping half —
 * the half that goes wrong in ways nobody notices for a week — sits where a
 * test can reach it. (vitest only globs `.ts` under test/.)
 */

import { STALE_MS, local, session } from './storage.js';

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

/** brandId, not slug — renaming a brand must not orphan what you were typing. */
export const assetDraftKey = (brandId: string, kind: CreateKind): string => `scenri:new-${brandId}-${kind}`;

const read = (key: string): string | null => session.get(key);
const write = (key: string, value: string): void => session.set(key, value);

/**
 * Also evicts the localStorage key of the same name. Drafts lived there until
 * this became session-scoped, and one nobody reads any more is still a key
 * holding somebody's photographs — this is the only chance we get to drop it.
 */
function remove(key: string): void {
  session.del(key);
  local.del(key);
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
 * The build this draft was sent as has landed, so the draft is spent.
 *
 * A presenter does not exist when its job is queued; it exists when the build
 * writes it. Until then the draft is held on purpose, marked with the job, so a
 * failure can hand the photographs back. This is the other end of that: the
 * asset arrived, the attempt is over, and nothing it was made from should be
 * waiting in the next form someone opens.
 *
 * Keyed on the job id rather than clearing whatever is there, because by the
 * time a build lands the person may already be typing the next one.
 */
export function spendAssetDraft(brandId: string, kind: CreateKind, jobId: string): void {
  const draft = loadAssetDraft(brandId, kind);
  if (draft?.pending === jobId) clearAssetDraft(brandId, kind);
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
