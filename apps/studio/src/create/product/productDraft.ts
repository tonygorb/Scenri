import { STALE_MS, session } from '../../storage.js';
import { initialStudio, type Candidate, type StudioState } from './studioState.js';

/**
 * The product studio's draft: one product-addition attempt, kept for as long
 * as the tab lives.
 *
 * Unlike createDraft.ts, this one is written while the work is in progress and
 * rehydrates while a view is still being drawn. The presenter and scene forms
 * refuse exactly that on purpose (a running build must not refill a fresh
 * form), and the difference is the reason this is its own file: the work in a
 * product draft is minutes of generation and a decision per view, not a name
 * someone typed, and losing it to a reload would be the app throwing away
 * what the person just spent.
 *
 * Same lane and the same rules otherwise: sessionStorage, content hashes and
 * never bytes, keyed on the brand id, stale after a month, and never another
 * brand's. No React import, so vitest can reach it.
 */
export const productDraftKey = (brandId: string): string => `scenri:product-studio-${brandId}`;

interface Stored {
  v: 1;
  brandId: string;
  updatedAt: string;
  state: Omit<StudioState, 'reading' | 'readingReason'> & { reading: StudioState['reading'] };
}

const HASH = /^[a-f0-9]{32}$/;

export function saveProductDraft(brandId: string, state: StudioState): void {
  if (!state.photos.length) {
    clearProductDraft(brandId);
    return;
  }
  // a read in flight cannot be resumed, only re-run
  const reading = state.reading === 'reading' ? 'idle' : state.reading;
  const stored: Stored = {
    v: 1,
    brandId,
    updatedAt: new Date().toISOString(),
    state: { ...state, reading },
  };
  session.set(productDraftKey(brandId), JSON.stringify(stored));
}

export function clearProductDraft(brandId: string): void {
  session.del(productDraftKey(brandId));
}

/** The stored draft as a studio state, or null when there is none, it is not this brand's, or it cannot be trusted. */
export function loadProductDraft(brandId: string): StudioState | null {
  const key = productDraftKey(brandId);
  const raw = session.get(key);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    session.del(key);
    return null;
  }
  const d = parsed as Partial<Stored>;
  if (!d || typeof d !== 'object' || d.v !== 1 || d.brandId !== brandId || !d.state || typeof d.state !== 'object') {
    session.del(key);
    return null;
  }
  const age = Date.now() - Date.parse(d.updatedAt ?? '');
  if (!Number.isFinite(age) || age > STALE_MS) {
    session.del(key);
    return null;
  }
  const st = d.state as Partial<StudioState>;
  const base = initialStudio(
    typeof st.draftId === 'string' && st.draftId ? st.draftId : `d-${Date.now().toString(36)}`,
  );
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const photos = Array.isArray(st.photos)
    ? st.photos
        .filter((p: any) => p && HASH.test(String(p.hash)))
        .map((p: any) => ({ hash: String(p.hash), angle: typeof p.angle === 'string' ? p.angle : null }))
    : [];
  if (!photos.length) {
    session.del(key);
    return null;
  }
  const kept = Array.isArray(st.kept)
    ? st.kept
        .filter((k: any) => k && HASH.test(String(k.hash)) && typeof k.angle === 'string')
        .map((k: any) => ({ hash: String(k.hash), angle: String(k.angle) }))
    : [];
  const c = st.candidate as Partial<Candidate> | null | undefined;
  const candidate: Candidate | null =
    c && typeof c.jobId === 'string' && typeof c.angle === 'string'
      ? {
          jobId: c.jobId,
          angle: c.angle,
          attempt: Number(c.attempt ?? 1) || 1,
          stage: 'queued',
          hash: null,
          error: null,
        }
      : null;
  const reading = (['idle', 'done', 'unavailable', 'failed'] as const).find((r) => r === st.reading) ?? 'idle';
  return {
    ...base,
    photos,
    reading,
    sheet: st.sheet && typeof st.sheet === 'object' ? (st.sheet as StudioState['sheet']) : null,
    conflict: str(st.conflict, 200),
    coverage: Array.isArray(st.coverage) ? st.coverage.filter((x) => typeof x === 'string').slice(0, 2) : [],
    category: typeof st.category === 'string' ? st.category : null,
    kept,
    candidate,
    building: !!st.building,
    skipped: Array.isArray(st.skipped) ? st.skipped.filter((x) => typeof x === 'string') : [],
    cover: typeof st.cover === 'string' && HASH.test(st.cover) ? st.cover : null,
    name: str(st.name, 80),
    dimensions: str(st.dimensions, 120),
    selected: typeof st.selected === 'string' ? st.selected : (photos[0]?.hash ?? null),
  };
}
