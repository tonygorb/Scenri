import { describe, expect, it } from 'vitest';
import {
  boardOf,
  canSave,
  coverHashOf,
  initialStudio,
  nextAngleOf,
  offerOf,
  reduce,
  type StudioState,
} from '../src/create/product/studioState.js';

/**
 * The product studio's state, with no React in it: what the photographs
 * establish, what the read adds, which view is drawn next, and what Save may
 * write. Every rule the surface shows is decided here so a test can reach it.
 */
const H = (c: string) => c.repeat(32);
const sheet = {
  promptName: 'Amber Glass Dropper Bottle',
  description: 'A 30 ml amber glass dropper bottle.',
  materials: 'amber glass',
  primaryColors: 'deep amber',
  preservationNotes: 'Keep the proportion.',
  negativeConstraints: 'Never invent lettering.',
  category: 'beauty',
};

const withPhotos = (n: number): StudioState =>
  reduce(initialStudio('d1'), { t: 'photosAdded', hashes: Array.from({ length: n }, (_, i) => H(String(i))) });

const read = (s: StudioState, angles: string[], extra: Partial<{ conflict: string; coverage: string[] }> = {}) =>
  reduce(s, { t: 'readingDone', available: true, reason: null, sheet, angles, conflict: '', coverage: [], ...extra });

describe('photographs', () => {
  it('one photograph is a valid product, and nothing else is required to save', () => {
    const s = withPhotos(1);
    expect(s.photos.map((p) => p.hash)).toEqual([H('0')]);
    expect(canSave(s)).toBe(true);
    expect(canSave(initialStudio('d1'))).toBe(false);
  });

  it('the same photograph twice is one photograph, and a removed one takes its label with it', () => {
    let s = reduce(withPhotos(2), { t: 'photosAdded', hashes: [H('1'), H('2')] });
    expect(s.photos).toHaveLength(3);
    s = read(s, ['front', 'side', 'label']);
    s = reduce(s, { t: 'photoRemoved', hash: H('1') });
    expect(s.photos.map((p) => p.angle)).toEqual(['front', 'label']);
    // the last photograph cannot go
    s = reduce(reduce(s, { t: 'photoRemoved', hash: H('0') }), { t: 'photoRemoved', hash: H('2') });
    expect(s.photos).toHaveLength(1);
  });
});

describe('the read', () => {
  it('labels each photograph, keeps the sheet, and offers to draw only what the photographs do not cover', () => {
    const s = read(withPhotos(1), ['front']);
    expect(s.sheet?.promptName).toBe('Amber Glass Dropper Bottle');
    expect(s.category).toBe('beauty');
    expect(s.photos[0].angle).toBe('front');
    // beauty asks for three-quarter, front, label: front is here, a label is never drawn
    expect(nextAngleOf(s)).toBe('three-quarter');
    expect(offerOf(s)).toBe('recommended');
  });

  it('offers nothing when the photographs already cover the plan, or when they fill every seat', () => {
    expect(offerOf(read(withPhotos(2), ['front', 'three-quarter']))).toBe('none');
    expect(offerOf(read(withPhotos(3), ['other', 'other', 'other']))).toBe('none');
  });

  it('says so when nothing could read the photographs, and still offers the fallback views', () => {
    const s = reduce(withPhotos(1), {
      t: 'readingDone',
      available: false,
      reason: 'Codex is not installed',
      sheet: null,
      angles: ['other'],
      conflict: '',
      coverage: [],
    });
    expect(s.reading).toBe('unavailable');
    expect(s.readingReason).toBe('Codex is not installed');
    expect(s.sheet).toBeNull();
    expect(nextAngleOf(s)).toBe('three-quarter');
    // a view still costs a generation, which needs an engine: the surface gates on that
    expect(offerOf(s)).toBe('recommended');
  });

  it('carries a conflict and the coverage notes, and a corrected category re-plans', () => {
    let s = read(withPhotos(2), ['front', 'front'], {
      conflict: 'The second photograph shows the clear glass colorway.',
      coverage: ['A photograph of the label would pin the lettering.'],
    });
    expect(s.conflict).toMatch(/clear glass/);
    expect(s.coverage).toHaveLength(1);
    s = reduce(s, { t: 'categoryChanged', category: 'footwear' });
    expect(nextAngleOf(s)).toBe('three-quarter');
    s = reduce(s, { t: 'categoryChanged', category: 'apparel' });
    expect(nextAngleOf(s)).toBeNull();
  });
});

describe('drawn views', () => {
  const ready = () => {
    let s = read(withPhotos(1), ['front']);
    s = reduce(s, { t: 'buildStarted' });
    s = reduce(s, { t: 'candidateStarted', jobId: 'pc-1', angle: 'three-quarter', attempt: 1 });
    return reduce(s, {
      t: 'candidatePolled',
      candidate: { id: 'pc-1', stage: 'ready', hash: H('a'), error: null, angle: 'three-quarter', attempt: 1 },
    });
  };

  it('a kept view joins the board after the photographs, and the next planned view follows', () => {
    let s = ready();
    expect(s.candidate?.stage).toBe('ready');
    s = reduce(s, { t: 'candidateKept' });
    expect(s.kept).toEqual([{ hash: H('a'), angle: 'three-quarter' }]);
    expect(s.candidate).toBeNull();
    expect(boardOf(s).map((b) => b.source)).toEqual(['photo', 'derived']);
    // beauty: three-quarter is kept, front is a photograph, label is never drawn
    expect(nextAngleOf(s)).toBeNull();
    expect(canSave(s)).toBe(true);
  });

  it('try again replaces the candidate rather than adding to it, and carries the correction', () => {
    let s = ready();
    s = reduce(s, { t: 'candidateRejected' });
    expect(s.candidate).toBeNull();
    expect(s.kept).toEqual([]);
    expect(s.retrying).toBe('three-quarter');
    s = reduce(s, { t: 'correctionChanged', correction: 'The cap is narrower.' });
    s = reduce(s, { t: 'candidateStarted', jobId: 'pc-2', angle: 'three-quarter', attempt: 2 });
    expect(s.candidate).toMatchObject({ jobId: 'pc-2', attempt: 2 });
    expect(s.retrying).toBeNull();
    expect(s.correction).toBe('');
  });

  it('a skipped angle is not offered again, and the next planned one is', () => {
    let s = read(withPhotos(1), ['other']);
    expect(nextAngleOf(s)).toBe('three-quarter');
    s = reduce(s, { t: 'angleSkipped', angle: 'three-quarter' });
    expect(nextAngleOf(s)).toBe('front');
    expect(s.retrying).toBeNull();
  });

  it('cannot save while a view is being drawn, and a removed view re-opens its angle', () => {
    let s = read(withPhotos(1), ['front']);
    s = reduce(s, { t: 'candidateStarted', jobId: 'pc-1', angle: 'three-quarter', attempt: 1 });
    expect(canSave(s)).toBe(false);
    s = reduce(s, {
      t: 'candidatePolled',
      candidate: { id: 'pc-1', stage: 'ready', hash: H('a'), error: null, angle: 'three-quarter', attempt: 1 },
    });
    s = reduce(s, { t: 'candidateKept' });
    s = reduce(s, { t: 'viewRemoved', hash: H('a') });
    expect(s.kept).toEqual([]);
    expect(nextAngleOf(s)).toBe('three-quarter');
  });

  it('a failed or lost draw leaves the photographs and every kept view alone', () => {
    let s = ready();
    s = reduce(s, { t: 'candidateKept' });
    s = reduce(s, { t: 'candidateStarted', jobId: 'pc-2', angle: 'side', attempt: 1 });
    s = reduce(s, {
      t: 'candidatePolled',
      candidate: { id: 'pc-2', stage: 'failed', hash: null, error: 'engine went away', angle: 'side', attempt: 1 },
    });
    expect(s.candidate?.stage).toBe('failed');
    expect(s.kept).toHaveLength(1);
    expect(s.photos).toHaveLength(1);
    s = reduce(s, { t: 'candidateLost' });
    expect(s.candidate).toBeNull();
    expect(s.kept).toHaveLength(1);
  });
});

describe('the cover', () => {
  it('is the three-quarter photograph by rule, never a drawn view, and can be chosen', () => {
    let s = read(withPhotos(2), ['front', 'three-quarter']);
    expect(coverHashOf(s)).toBe(H('1'));
    s = reduce(s, { t: 'coverChosen', hash: H('0') });
    expect(coverHashOf(s)).toBe(H('0'));
    s = reduce(s, { t: 'photoRemoved', hash: H('0') });
    expect(coverHashOf(s)).toBe(H('1'));
  });
});
