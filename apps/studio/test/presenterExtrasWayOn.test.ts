import { describe, expect, it } from 'vitest';
import type { Question, Turn } from '../src/conversation/question.js';
import { EMPTY_STATE, deserialize, reduce, serialize } from '../src/create/presenter/creationState.js';
import { seedStateFromDraft, turnsFor } from '../src/create/presenter/presenterFlowRules.js';
import type { Answers } from '../src/create/presenter/presenterQuestions.js';
import { stoppedOrFailed } from '../src/create/presenter/presenterRecordTurns.js';
import { type DraftLike, emptySlot } from '../src/create/presenter/presenterStudioRules.js';

/**
 * The extra views are an offer, never a debt. An extra that will not draw can
 * be let go, and "Not now" is a decision the conversation keeps.
 */
const TAPPED: Answers = {
  source: { door: 'scratch', via: 'taps' },
  'look-who': { pick: 'woman' },
  'look-age': { pick: '30s' },
  'look-hair': { pick: 'brown' },
  'look-length': { pick: 'long' },
  'look-skin': { pick: 'olive' },
  'look-build': { pick: 'lean' },
  'look-heritage': { pick: 'Mediterranean' },
  'look-eyes': { pick: 'green' },
  'look-height': { pick: 'tall' },
  traits: [],
};
const approved = (hash: string) => ({ ...emptySlot(), status: 'approved' as const, hash });
const core = (over: Partial<DraftLike> = {}): DraftLike => ({
  source: 'synthetic',
  name: 'Idan',
  direction: 'a man in his 30s',
  views: {
    portrait: approved('p'),
    front: approved('f'),
    'three-quarter': approved('t'),
    back: emptySlot(),
    left: emptySlot(),
    right: emptySlot(),
  },
  activeView: null,
  stage: 'idle',
  ...over,
});
const turns = (d: DraftLike, over: { failed?: string; declined?: boolean } = {}) =>
  turnsFor({
    state: { ...EMPTY_STATE, answers: TAPPED, extrasDeclined: !!over.declined },
    draft: d,
    canGenerate: true,
    failed: over.failed ?? null,
  });
const open = (T: Turn[]): Question | null => {
  const t = T[T.length - 1];
  return t?.kind === 'question' ? t.question : null;
};
const ids = (q: Question | null) => (q?.kind === 'confirm' ? q.options.map((o) => o.id) : []);

describe('an extra view that will not draw', () => {
  it('failed on the server: Retry, and a way on without the extras', () => {
    const d = core({ extras: true, views: { ...core().views, back: { ...emptySlot(), error: 'refused' } } });
    expect(ids(open(turns(d)))).toEqual(['retry', 'skip-extras']);
  });

  it('refused before it reached the engine: the same way on', () => {
    expect(ids(open(turns(core({ extras: true }), { failed: 'refused by the provider' })))).toEqual([
      'retry',
      'skip-extras',
    ]);
  });

  it('stopped: offered again, or let go', () => {
    expect(ids(stoppedOrFailed('left', 'cancelled'))).toEqual(['retry', 'skip-extras']);
  });

  it('a core view that fails has no such way: the set needs it', () => {
    expect(ids(stoppedOrFailed('front', 'refused'))).toEqual(['retry']);
  });

  it('let go, it is not asked about again, and the save is next', () => {
    const d = core({ extras: false, views: { ...core().views, back: { ...emptySlot(), error: 'refused' } } });
    const q = open(turns(d, { declined: true }));
    expect(q?.id).toBe('save');
  });
});

describe('"Not now" to the extra views', () => {
  it('survives a reload', () => {
    const declined = reduce({ ...EMPTY_STATE, answers: TAPPED }, { type: 'extras-declined' });
    const back = deserialize(serialize(declined));
    expect(back?.extrasDeclined).toBe(true);
  });

  it('is not written when it was never said, so an old copy reads back the same', () => {
    expect(JSON.parse(serialize({ ...EMPTY_STATE, answers: TAPPED })).extrasDeclined).toBeUndefined();
    expect(deserialize(serialize({ ...EMPTY_STATE, answers: TAPPED }))?.extrasDeclined).toBeUndefined();
  });

  it('is read off the draft by a page that has no copy of its own', () => {
    const setup = serialize(reduce({ ...EMPTY_STATE, answers: TAPPED }, { type: 'extras-declined' }));
    const seed = seedStateFromDraft({ ...core(), setup } as DraftLike);
    expect(seed.extrasDeclined).toBe(true);
    const restored = reduce(EMPTY_STATE, { type: 'restore', answers: seed.answers, revision: 1, ...seed });
    expect(restored.extrasDeclined).toBe(true);
    expect(open(turns(core(), { declined: restored.extrasDeclined }))?.id).toBe('save');
  });
});
