import { plannedViews } from '../../productCategories.js';
import { coverOf } from '../../productCover.js';

/**
 * The product studio's state, with no React in it.
 *
 * A product is established from photographs. Photographs are facts: they need
 * no approval and they are never outranked. The read adds the sheet and a
 * label per photograph; from those the studio plans which views are worth
 * drawing, draws them one at a time, and holds each for a decision. Every
 * rule the surface shows is decided here, where a test can reach it, the way
 * draft.ts and createDraft.ts keep their bookkeeping out of components.
 */

/** Enough to hold a store's angle set; a brief attaches three of them. */
export const MAX_PHOTOS = 6;

export interface Photo {
  hash: string;
  /** The read's label, from the category's angle keys, or null before a read. */
  angle: string | null;
}

export interface KeptView {
  hash: string;
  angle: string;
}

export interface Sheet {
  promptName: string;
  description: string;
  materials: string;
  primaryColors: string;
  preservationNotes: string;
  negativeConstraints: string;
  category: string;
  colorways?: string[];
}

export type Reading = 'idle' | 'reading' | 'done' | 'unavailable' | 'failed';
export type CandidateStage = 'queued' | 'drawing' | 'ready' | 'failed' | 'cancelled';

export interface Candidate {
  jobId: string;
  angle: string;
  attempt: number;
  stage: CandidateStage;
  hash: string | null;
  error: string | null;
}

export interface StudioState {
  /** One product-addition attempt. The server keys its candidates on it. */
  draftId: string;
  photos: Photo[];
  reading: Reading;
  readingReason: string | null;
  sheet: Sheet | null;
  /** One sentence when the photographs disagree, else empty. */
  conflict: string;
  /** What a further photograph would buy. */
  coverage: string[];
  /** The read's category, or the one the person corrected it to. */
  category: string | null;
  kept: KeptView[];
  candidate: Candidate | null;
  /** The angle a Try again is about while its correction line is open. */
  retrying: string | null;
  /** Angles the person chose not to draw after a Try again. */
  skipped: string[];
  correction: string;
  /** The person chose to draw the planned views; the next one follows each Keep. */
  building: boolean;
  /** A cover the person chose, else the rule decides. */
  cover: string | null;
  name: string;
  dimensions: string;
  /** Which board picture the stage shows; null shows the candidate, else the first. */
  selected: string | null;
}

export type StudioAction =
  | { t: 'photosAdded'; hashes: string[] }
  | { t: 'photoRemoved'; hash: string }
  | { t: 'readingStarted' }
  | {
      t: 'readingDone';
      available: boolean;
      reason: string | null;
      sheet: Sheet | null;
      angles: string[];
      conflict: string;
      coverage: string[];
    }
  | { t: 'readingFailed'; reason: string }
  | { t: 'buildStarted' }
  | { t: 'candidateStarted'; jobId: string; angle: string; attempt: number }
  | {
      t: 'candidatePolled';
      candidate: {
        id: string;
        stage: string;
        hash: string | null;
        error: string | null;
        angle: string;
        attempt: number;
      };
    }
  | { t: 'candidateKept' }
  | { t: 'candidateRejected' }
  | { t: 'candidateLost' }
  | { t: 'retryDismissed' }
  | { t: 'angleSkipped'; angle: string }
  | { t: 'correctionChanged'; correction: string }
  | { t: 'viewRemoved'; hash: string }
  | { t: 'coverChosen'; hash: string | null }
  | { t: 'nameChanged'; name: string }
  | { t: 'categoryChanged'; category: string }
  | { t: 'dimensionsChanged'; dimensions: string }
  | { t: 'selected'; hash: string | null }
  | { t: 'hydrated'; state: StudioState };

export function initialStudio(draftId: string): StudioState {
  return {
    draftId,
    photos: [],
    reading: 'idle',
    readingReason: null,
    sheet: null,
    conflict: '',
    coverage: [],
    category: null,
    kept: [],
    candidate: null,
    retrying: null,
    skipped: [],
    correction: '',
    building: false,
    cover: null,
    name: '',
    dimensions: '',
    selected: null,
  };
}

const HASH = /^[a-f0-9]{32}$/;

export function reduce(s: StudioState, a: StudioAction): StudioState {
  switch (a.t) {
    case 'photosAdded': {
      const have = new Set(s.photos.map((p) => p.hash));
      const fresh = a.hashes.filter((h) => HASH.test(h) && !have.has(h) && have.add(h));
      const photos = [...s.photos, ...fresh.map((hash) => ({ hash, angle: null }))].slice(0, MAX_PHOTOS);
      return { ...s, photos, selected: s.selected ?? photos[0]?.hash ?? null };
    }
    case 'photoRemoved': {
      if (s.photos.length <= 1 || !s.photos.some((p) => p.hash === a.hash)) return s;
      const photos = s.photos.filter((p) => p.hash !== a.hash);
      return {
        ...s,
        photos,
        cover: s.cover === a.hash ? null : s.cover,
        selected: s.selected === a.hash ? (photos[0]?.hash ?? null) : s.selected,
      };
    }
    case 'readingStarted':
      return { ...s, reading: 'reading', readingReason: null };
    case 'readingDone': {
      const photos = s.photos.map((p, i) => ({ ...p, angle: a.angles[i] ?? 'other' }));
      return {
        ...s,
        photos,
        reading: a.available ? 'done' : 'unavailable',
        readingReason: a.reason,
        sheet: a.sheet,
        conflict: a.conflict,
        coverage: a.coverage,
        category: a.sheet?.category ?? s.category,
      };
    }
    case 'readingFailed':
      return { ...s, reading: 'failed', readingReason: a.reason };
    case 'buildStarted':
      return { ...s, building: true };
    case 'candidateStarted':
      return {
        ...s,
        candidate: { jobId: a.jobId, angle: a.angle, attempt: a.attempt, stage: 'queued', hash: null, error: null },
        retrying: null,
        correction: '',
        selected: null,
      };
    case 'candidatePolled': {
      if (!s.candidate || s.candidate.jobId !== a.candidate.id) return s;
      const stage = (['queued', 'drawing', 'ready', 'failed', 'cancelled'] as const).find(
        (x) => x === a.candidate.stage,
      );
      return {
        ...s,
        candidate: { ...s.candidate, stage: stage ?? 'failed', hash: a.candidate.hash, error: a.candidate.error },
      };
    }
    case 'candidateKept': {
      const c = s.candidate;
      if (!c?.hash || c.stage !== 'ready') return s;
      return { ...s, kept: [...s.kept, { hash: c.hash, angle: c.angle }], candidate: null, selected: c.hash };
    }
    case 'candidateRejected':
      return s.candidate
        ? { ...s, retrying: s.candidate.angle, candidate: null, selected: s.photos[0]?.hash ?? null }
        : s;
    case 'candidateLost':
      return { ...s, candidate: null, selected: s.selected ?? s.photos[0]?.hash ?? null };
    case 'retryDismissed':
      return { ...s, retrying: null, correction: '' };
    case 'angleSkipped':
      return {
        ...s,
        retrying: null,
        correction: '',
        skipped: s.skipped.includes(a.angle) ? s.skipped : [...s.skipped, a.angle],
      };
    case 'correctionChanged':
      return { ...s, correction: a.correction.slice(0, 200) };
    case 'viewRemoved': {
      const kept = s.kept.filter((k) => k.hash !== a.hash);
      return {
        ...s,
        kept,
        cover: s.cover === a.hash ? null : s.cover,
        selected: s.selected === a.hash ? (s.photos[0]?.hash ?? null) : s.selected,
      };
    }
    case 'coverChosen':
      return { ...s, cover: a.hash };
    case 'nameChanged':
      return { ...s, name: a.name.slice(0, 80) };
    case 'categoryChanged':
      return { ...s, category: a.category };
    case 'dimensionsChanged':
      return { ...s, dimensions: a.dimensions.slice(0, 120) };
    case 'selected':
      return { ...s, selected: a.hash };
    case 'hydrated':
      return a.state;
    default:
      return s;
  }
}

/* -------------------------------------------------------------- selectors */

export interface BoardItem {
  hash: string;
  angle: string | null;
  source: 'photo' | 'derived';
}

/** Photographs first, then the kept views: the order the compiler reads, and the order the rail shows. */
export function boardOf(s: StudioState): BoardItem[] {
  return [
    ...s.photos.map((p): BoardItem => ({ hash: p.hash, angle: p.angle, source: 'photo' })),
    ...s.kept.map((k): BoardItem => ({ hash: k.hash, angle: k.angle, source: 'derived' })),
  ];
}

/** The next view worth drawing, or null when the board covers the plan or fills every seat. */
export function nextAngleOf(s: StudioState): string | null {
  const covered = [...s.photos.map((p) => p.angle), ...s.kept.map((k) => k.angle)];
  return plannedViews(s.category, covered).find((a) => !s.skipped.includes(a)) ?? null;
}

/**
 * Whether to offer drawing at all, and how loudly. One photograph is the case
 * a drawn view helps most; with several, the photographs already pin the
 * shape and the offer steps back. Nothing to draw, no offer.
 */
export function offerOf(s: StudioState): 'recommended' | 'available' | 'none' {
  if (!s.photos.length || s.reading === 'reading' || !nextAngleOf(s)) return 'none';
  return s.photos.length === 1 ? 'recommended' : 'available';
}

export function drawing(s: StudioState): boolean {
  return !!s.candidate && (s.candidate.stage === 'queued' || s.candidate.stage === 'drawing');
}

export function canSave(s: StudioState): boolean {
  return s.photos.length > 0 && !drawing(s) && s.reading !== 'reading';
}

/** The cover the product will be saved with: the chosen one, else the rule productCover.ts states. */
export function coverHashOf(s: StudioState): string | null {
  const board = boardOf(s);
  if (s.cover && board.some((b) => b.hash === s.cover)) return s.cover;
  const ref = coverOf({
    shots: board.map((b) => ({ file: `asset:${b.hash}`, angle: b.angle ?? undefined, source: b.source })),
  });
  return ref ? ref.replace(/^asset:/, '') : null;
}
