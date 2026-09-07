import { describe, expect, it } from 'vitest';
import type { AssetBuild, AssetBuildFrame } from '../src/apiTypes.js';
import {
  TARGET_MAX,
  TARGET_MIN,
  boardFrames,
  canAddView,
  canRemove,
  clampTarget,
  coverChoices,
  defaultCover,
  drawnHashes,
  frameLabel,
  primaryFor,
  resumeDecision,
  screenFor,
  statusLine,
  viewCounter,
} from '../src/create/scene/sceneBuildRules.js';

const H = (n: number) => n.toString(16).padStart(32, '0');
const frame = (p: Partial<AssetBuildFrame> & { hash: string | null }): AssetBuildFrame => ({
  purpose: 'view',
  status: 'landed',
  origin: 'view',
  ...p,
});
const build = (p: Partial<AssetBuild> = {}): AssetBuild => ({
  id: 'ab-1',
  brandId: 'b',
  kind: 'scene',
  name: '',
  stage: 'reviewing',
  step: 0,
  steps: 4,
  message: null,
  assetId: null,
  previewHash: null,
  warnings: [],
  coverage: [],
  facets: [],
  error: null,
  startedAt: '2026-09-08T00:00:00.000Z',
  finished: false,
  frames: [],
  record: null,
  suggestedName: null,
  cover: null,
  target: 4,
  ...p,
});
const seed = frame({ hash: H(1), purpose: 'seed', origin: 'seed' });
const upload = frame({ hash: H(9), purpose: 'upload', origin: 'upload' });
const wide = frame({ hash: H(2), purpose: 'wide' });
const surface = frame({ hash: H(3), purpose: 'surface' });
const angle = frame({ hash: H(4), purpose: 'angle' });
const drawing = frame({ hash: null, purpose: 'angle', status: 'drawing' });

describe('the scene builder decides its screen from the job', () => {
  it('maps every stage to a screen, and the two non-jobs to theirs', () => {
    const want: Record<AssetBuild['stage'], ReturnType<typeof screenFor>> = {
      queued: 'seeding',
      analyzing: 'seeding',
      building: 'seeding',
      seeding: 'seeding',
      awaiting: 'awaiting',
      viewing: 'viewing',
      consensus: 'viewing',
      reviewing: 'reviewing',
      saving: 'saving',
      done: 'saving',
      failed: 'failed',
      cancelled: 'failed',
    };
    for (const [stage, screen] of Object.entries(want)) {
      expect(screenFor(build({ stage: stage as AssetBuild['stage'] }))).toBe(screen);
    }
    expect(screenFor(null)).toBe('entry');
    expect(screenFor('gone')).toBe('gone');
    expect(screenFor('loading')).toBe('seeding');
  });

  it('holds the set to four through six', () => {
    expect(clampTarget(undefined)).toBe(TARGET_MIN);
    expect(clampTarget(Number.NaN)).toBe(TARGET_MIN);
    expect(clampTarget(3)).toBe(4);
    expect(clampTarget(7)).toBe(TARGET_MAX);
    expect(clampTarget(5)).toBe(5);
  });

  it('boards the seed first, then uploads, then views, then the one being drawn; and names them', () => {
    const b = build({ frames: [upload, wide, seed, drawing, surface] });
    const board = boardFrames(b);
    expect(board.map((f) => f.hash)).toEqual([H(1), H(9), H(2), H(3), null]);
    expect(frameLabel(board, seed)).toBe('First frame');
    expect(frameLabel(board, upload)).toBe('Reference 1');
    expect(frameLabel(board, wide)).toBe('View 1');
    expect(frameLabel(board, surface)).toBe('View 2');
    expect(drawnHashes(b)).toEqual([H(2), H(1), H(3)]);
    // A rejected frame is off the board and out of the count.
    const rejected = build({ frames: [seed, { ...wide, status: 'rejected' }] });
    expect(boardFrames(rejected).map((f) => f.hash)).toEqual([H(1)]);
  });

  it('counts the view being drawn as the next one of the target', () => {
    expect(viewCounter(build({ frames: [seed, wide, drawing], target: 4 }))).toEqual({ n: 3, of: 4 });
    expect(viewCounter(build({ frames: [seed, wide, surface, angle], target: 4 }))).toEqual({ n: 4, of: 4 });
  });

  it('says what the primary does on every screen', () => {
    const ctx = { typed: false, uploads: 0, name: '', busy: false, canGenerate: true, build: null, drawn: 0 };
    expect(primaryFor('entry', ctx)).toMatchObject({ label: 'Draw the world', ready: false });
    expect(primaryFor('entry', { ...ctx, typed: true })).toMatchObject({ label: 'Draw the world', ready: true });
    expect(primaryFor('entry', { ...ctx, uploads: 2 })).toMatchObject({ label: 'Read the references', ready: true });
    expect(primaryFor('entry', { ...ctx, uploads: 2, typed: true }).label).toBe('Draw the world');
    expect(primaryFor('entry', { ...ctx, typed: true, busy: true }).ready).toBe(false);
    expect(primaryFor('seeding', { ...ctx, build: build({ stage: 'analyzing' }) })).toMatchObject({
      label: 'Reading the direction',
      ready: false,
    });
    expect(primaryFor('seeding', { ...ctx, uploads: 1, build: build({ stage: 'analyzing' }) }).label).toBe(
      'Reading the references',
    );
    expect(primaryFor('seeding', { ...ctx, build: build({ stage: 'seeding' }) }).label).toBe('Drawing the world');
    expect(primaryFor('awaiting', ctx)).toMatchObject({ label: 'Yes, this world', ready: true });
    expect(
      primaryFor('viewing', { ...ctx, build: build({ stage: 'viewing', frames: [seed, wide, drawing] }) }),
    ).toEqual({
      label: 'Drawing view 3 of 4',
      ready: false,
    });
    expect(primaryFor('viewing', { ...ctx, build: build({ stage: 'consensus' }) }).label).toBe('Reading the set');
    expect(primaryFor('reviewing', ctx)).toMatchObject({
      label: 'Save scene',
      ready: false,
      blocked: 'Name this scene',
    });
    expect(primaryFor('reviewing', { ...ctx, name: 'Dusk Shore' }).ready).toBe(true);
    expect(primaryFor('saving', ctx)).toMatchObject({ label: 'Saving', ready: false });
    expect(primaryFor('failed', ctx)).toMatchObject({ label: 'Try again', ready: true });
    expect(primaryFor('failed', { ...ctx, drawn: 2 }).label).toBe('Continue');
    expect(primaryFor('gone', { ...ctx, drawn: 3 }).label).toBe('Continue');
  });

  it('defaults the cover to the seed, and keeps an upload off a figure-led cover unless it was drawn before', () => {
    const place = build({ frames: [upload, seed, wide] });
    expect(defaultCover(place)).toBe(H(1));
    expect(coverChoices(place)).toEqual([H(1), H(9), H(2)]);
    expect(defaultCover(build({ frames: [upload, seed, wide], cover: H(2) }))).toBe(H(2));
    const figure = build({ frames: [upload, seed, wide], record: { figure: 'someone at the ledge' } });
    expect(coverChoices(figure)).toEqual([H(1), H(2)]);
    expect(coverChoices(figure, [H(9)])).toEqual([H(1), H(9), H(2)]);
    // A cover the job names that is not eligible is ignored.
    expect(defaultCover(build({ frames: [upload, seed], cover: H(9), record: { figure: 'x' } }))).toBe(H(1));
    // Nothing landed: nothing to choose.
    expect(defaultCover(build({ frames: [drawing] }))).toBeNull();
  });

  it('never removes the seed or the last frame, and says when a removal redraws', () => {
    const full = build({ frames: [seed, wide, surface, angle], target: 4 });
    expect(canRemove(full, H(1)).ok).toBe(false);
    expect(canRemove(full, H(2))).toEqual({ ok: true, redraws: true });
    const over = build({ frames: [seed, wide, surface, angle, frame({ hash: H(5), purpose: 'light' })], target: 4 });
    expect(canRemove(over, H(5))).toEqual({ ok: true, redraws: false });
    expect(canRemove(build({ frames: [wide] }), H(2)).ok).toBe(false);
    expect(canRemove(full, 'nope').ok).toBe(false);
  });

  it('adds a view only while nothing is drawing and the set is under six', () => {
    expect(canAddView(build({ frames: [seed, wide] }))).toEqual({ ok: true });
    expect(canAddView(build({ frames: [seed, drawing] })).ok).toBe(false);
    const six = [
      seed,
      wide,
      surface,
      angle,
      frame({ hash: H(5), purpose: 'light' }),
      frame({ hash: H(6), purpose: 'zone' }),
    ];
    expect(canAddView(build({ frames: six })).ok).toBe(false);
  });

  it('picks the job back up: the URL first, then the draft, then the one running', () => {
    const live = [
      { id: 'ab-p', kind: 'presenter' as const, finished: false },
      { id: 'ab-old', kind: 'scene' as const, finished: true },
      { id: 'ab-live', kind: 'scene' as const, finished: false },
    ];
    expect(resumeDecision({ param: 'ab-url', draftPending: 'ab-draft', live })).toEqual({ attach: 'ab-url' });
    expect(resumeDecision({ param: null, draftPending: 'ab-draft', live })).toEqual({ attach: 'ab-draft' });
    expect(resumeDecision({ param: null, draftPending: null, live })).toEqual({ attach: 'ab-live' });
    expect(resumeDecision({ param: null, draftPending: null, live: live.slice(0, 2) })).toBeNull();
  });

  it('reads one sentence per screen', () => {
    expect(statusLine('entry', null)).toBe('');
    expect(statusLine('seeding', build({ stage: 'analyzing' }))).toBe('Reading the references.');
    expect(statusLine('seeding', build({ stage: 'seeding' }))).toBe('Drawing the first frame.');
    expect(statusLine('awaiting', build())).toBe('The first frame is ready. Is this the world?');
    expect(statusLine('viewing', build({ stage: 'viewing', frames: [seed, wide, drawing] }))).toBe(
      'View 1 of 3 landed.',
    );
    expect(statusLine('viewing', build({ stage: 'consensus' }))).toBe('Reading the set.');
    expect(statusLine('reviewing', build({ frames: [seed, wide, surface, angle] }))).toBe(
      '4 frames. Name it and save.',
    );
    expect(statusLine('reviewing', build({ frames: [seed] }))).toBe('One frame. Name it and save.');
    expect(statusLine('saving', build())).toBe('Saving.');
    expect(statusLine('failed', build({ stage: 'cancelled' }))).toBe('Stopped.');
    expect(statusLine('gone', null)).toMatch(/still here/);
  });
});
