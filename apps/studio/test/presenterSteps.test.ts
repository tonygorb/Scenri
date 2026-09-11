import { describe, expect, it } from 'vitest';
import { EMPTY_STATE, NO_DRAFT } from '../src/create/presenter/creationState.ts';
import {
  compileDirection,
  compileItems,
  flowContext,
  seedFromDraft,
} from '../src/create/presenter/presenterFlowRules.ts';
import type { Answers } from '../src/create/presenter/presenterQuestions.ts';
import { type StepDraft, type StepInputs, inStep, nextStep, stepKey } from '../src/create/presenter/presenterSteps.ts';
import { emptySlot } from '../src/create/presenter/presenterStudioRules.ts';

/**
 * What the flow does next, situation by situation.
 *
 * Every row is a state the app has actually been in, most of them one it got
 * stuck in. The decision is a pure function now, so the table is the whole
 * contract: change the function and a row goes red with the situation named.
 */
const slot = (over: Record<string, unknown> = {}) => ({ ...emptySlot(), ...over });
const approved = (hash: string) => slot({ status: 'approved', hash });

const TAPPED: Answers = {
  source: { door: 'scratch', via: 'taps' },
  'look-who': 'woman',
  'look-age': '30s',
  'look-hair': 'black',
  'look-length': 'shoulder',
  'look-skin': 'olive',
  'look-build': 'solid',
  traits: [],
};
const TYPED: Answers = {
  source: { door: 'scratch', via: 'typed' },
  describe: 'a woman in her 30s with shoulder-length black hair, olive skin, a solid build',
  traits: [],
};

const draft = (over: Partial<StepDraft> = {}): StepDraft => ({
  id: 'pd-1',
  generations: 0,
  source: 'synthetic',
  name: '',
  // a draft made from these answers carries exactly what they compile to
  direction: compileDirection(TAPPED),
  keep: '',
  detailRefs: {},
  views: {
    portrait: emptySlot(),
    front: emptySlot(),
    'three-quarter': emptySlot(),
    back: emptySlot(),
    left: emptySlot(),
    right: emptySlot(),
  },
  activeView: null,
  stage: 'idle',
  asks: [],
  results: [],
  decisions: [],
  ...over,
});

const inputs = (over: Partial<StepInputs> = {}): StepInputs => {
  const d = over.draft === undefined ? null : over.draft;
  return {
    state: { ...EMPTY_STATE, answers: TAPPED },
    draft: d,
    ctx: d ? flowContext(d, true) : NO_DRAFT,
    canDraw: true,
    busy: false,
    err: false,
    booting: false,
    draftId: d?.id ?? null,
    seededFor: d?.id ?? null,
    done: new Set<string>(),
    ...over,
  };
};

describe('what the flow does next', () => {
  it('nothing, while anything is in flight or standing in the way', () => {
    const d = draft();
    expect(nextStep(inputs({ draft: d, busy: true }))).toBeNull();
    expect(nextStep(inputs({ draft: d, err: true }))).toBeNull();
    expect(nextStep(inputs({ busy: true }))).toBeNull();
  });

  it('draws the face of a fresh draft whose answers are whole', () => {
    expect(nextStep(inputs({ draft: draft() }))).toEqual({ kind: 'draw', view: 'portrait', decide: undefined });
  });

  it('the full body decides itself no more than the face does, and the rest decide themselves', () => {
    const d = draft({ views: { ...draft().views, portrait: approved('p') } });
    expect(nextStep(inputs({ draft: d }))).toEqual({ kind: 'draw', view: 'front', decide: undefined });
    const d2 = draft({ views: { ...d.views, front: approved('f') } });
    expect(nextStep(inputs({ draft: d2 }))).toEqual({ kind: 'draw', view: 'three-quarter', decide: 'auto' });
  });

  it('nothing, while a view waits on a person or is being drawn', () => {
    const waiting = draft({ views: { ...draft().views, portrait: slot({ status: 'candidate', hash: 'p' }) } });
    expect(nextStep(inputs({ draft: waiting }))).toBeNull();
    const drawing = draft({ stage: 'drawing', activeView: 'portrait' });
    expect(nextStep(inputs({ draft: drawing }))).toBeNull();
  });

  it('nothing, while an answer is open or being changed, whatever the draft wants', () => {
    const d = draft();
    expect(nextStep(inputs({ draft: d, state: { ...EMPTY_STATE, answers: TAPPED, editing: 'look-hair' } }))).toBeNull();
    expect(nextStep(inputs({ draft: d, state: { ...EMPTY_STATE, answers: TAPPED, saying: 'look-hair' } }))).toBeNull();
    const half: Answers = { source: { door: 'scratch', via: 'taps' }, 'look-who': 'woman' };
    expect(nextStep(inputs({ draft: d, state: { ...EMPTY_STATE, answers: half } }))).toBeNull();
  });

  it('reads the answers off a draft the page arrived at with answers that cannot draw it, once', () => {
    // The stall: a draft with a direction on it, answers left over from a run
    // that is over, nothing drawing and nothing said. Opening the same draft in
    // a clean tab drew at once, which is how it showed itself.
    const d = draft();
    const half: Answers = { source: { door: 'scratch', via: 'taps' }, 'look-who': 'woman' };
    const step = nextStep(inputs({ draft: d, seededFor: null, state: { ...EMPTY_STATE, answers: half } }));
    expect(step?.kind).toBe('seed');
    // with no answers at all, the same
    expect(nextStep(inputs({ draft: d, seededFor: null, state: EMPTY_STATE }))?.kind).toBe('seed');
    // already read for this draft: a half-changed answer is somebody at work, and is left alone
    expect(nextStep(inputs({ draft: d, seededFor: d.id, state: { ...EMPTY_STATE, answers: half } }))).toBeNull();
    // whole answers on first sight need no reading: they draw
    expect(nextStep(inputs({ draft: d, seededFor: null }))?.kind).toBe('draw');
  });

  it('brings a draft in step with answers that moved, before anything is drawn from the old words', () => {
    const moved = draft({ direction: 'somebody else entirely', views: { ...draft().views, portrait: approved('p') } });
    const step = nextStep(inputs({ draft: moved }));
    expect(step?.kind).toBe('sync');
    if (step?.kind === 'sync') {
      expect(step.patch.direction).toBe(compileDirection(TAPPED));
      // the face was drawn from the old words, so it is drawn again
      expect(step.redo).toBe('portrait');
    }
    // nothing drawn yet: nothing to redo, the empty view is simply drawn when its turn comes
    const fresh = nextStep(inputs({ draft: draft({ direction: 'somebody else' }) }));
    expect(fresh?.kind === 'sync' && fresh.redo).toBeNull();
  });

  it('starts a draft from a description the moment nothing is left to ask, and never from the rows', () => {
    expect(nextStep(inputs({ state: { ...EMPTY_STATE, answers: TYPED } }))).toEqual({ kind: 'start' });
    // the rows end at a read-back and a tap: the press starts it, not this
    expect(nextStep(inputs({ state: { ...EMPTY_STATE, answers: TAPPED } }))).toBeNull();
    // and not while the page is still finding out, or a draft is on its way
    expect(nextStep(inputs({ state: { ...EMPTY_STATE, answers: TYPED }, booting: true }))).toBeNull();
    expect(nextStep(inputs({ state: { ...EMPTY_STATE, answers: TYPED }, draftId: 'pd-2' }))).toBeNull();
    // nor with nothing that can draw
    expect(nextStep(inputs({ state: { ...EMPTY_STATE, answers: TYPED }, canDraw: false }))).toBeNull();
  });

  it('a sync that will never take is asked for once, and never holds the drawing up', () => {
    // The server is the authority on what it can store: it truncates long text
    // and drops pictures it does not hold, so what it keeps can differ from
    // what was asked for and no amount of asking closes the gap. This used to
    // ask forever, with the draw stuck behind it and nothing on screen to say
    // so, which is the deadest of dead ends.
    const stuck = draft({ direction: 'what the server kept, which is not what was asked for' });
    const first = nextStep(inputs({ draft: stuck }));
    expect(first?.kind).toBe('sync');
    if (!first) return;
    const key = stepKey(first, inputs({ draft: stuck }));
    // asked once; now the flow steps over it and draws what the draft holds
    const after = nextStep(inputs({ draft: stuck, done: new Set([key]) }));
    expect(after).toEqual({ kind: 'draw', view: 'portrait', decide: undefined });
    // and it does not go back to asking: with only the last step remembered,
    // the sync and the draw would take turns being the one not just done
    const drawKey = stepKey(after, inputs({ draft: stuck }));
    expect(nextStep(inputs({ draft: stuck, done: new Set([key, drawKey]) }))).toBeNull();
  });

  it('a draw that will not take is asked for once, and then the flow rests', () => {
    const d = draft();
    const i = inputs({ draft: d });
    const step = nextStep(i);
    expect(step?.kind).toBe('draw');
    if (!step) return;
    expect(nextStep(inputs({ draft: d, done: new Set([stepKey(step, i)]) }))).toBeNull();
  });

  it('a step is keyed by what it is for, so it fires once and again only when that changes', () => {
    const d = draft();
    const i = inputs({ draft: d });
    const step = nextStep(i);
    expect(step).not.toBeNull();
    if (!step) return;
    const key = stepKey(step, i);
    expect(stepKey(step, i)).toBe(key);
    // the same view, tried once more: a different key
    const tried = { ...i, draft: draft({ views: { ...d.views, portrait: slot({ attempts: 1 }) } }) };
    const again = nextStep(tried);
    expect(again && stepKey(again, tried)).not.toBe(key);
    // a start is keyed by the answers' revision, one draft per person
    const s = inputs({ state: { ...EMPTY_STATE, answers: TYPED, revision: 4 } });
    const start = nextStep(s);
    expect(start && stepKey(start, s)).toBe('start:4');
  });
});

describe('a draft opened again', () => {
  const slot = (over: Record<string, unknown> = {}) => ({ status: 'empty', attempts: 0, rejected: [], ...over });
  const finished = {
    id: 'pd-1',
    source: 'synthetic' as const,
    name: 'Halden',
    direction: 'a man in their 30s with cropped brown hair, light olive skin, an average build',
    keepItems: [
      { id: 'glasses', words: 'bold thick black rectangular acetate frames' },
      { id: 'prosthetic', words: 'a glossy bright red mechanical prosthetic limb in place of their left arm' },
      { id: 'said', words: 'a chipped front tooth' },
    ],
    generations: 6,
    extras: false,
    activeView: null,
    stage: 'idle' as const,
    views: {
      portrait: slot({ status: 'approved', hash: 'p' }),
      front: slot({ status: 'approved', hash: 'f' }),
      'three-quarter': slot({ status: 'approved', hash: 't' }),
      back: slot(),
      left: slot(),
      right: slot(),
    },
  } as never;

  it('is already in step with what it holds, so nothing is sent and nothing is redrawn', () => {
    // Read back with no details, the answers disagreed with the draft, the
    // sync to put that right wrote the emptiness back, and the redraw that
    // followed staled every view built on the face. Six approved views, gone.
    const answers = seedFromDraft(finished);
    expect(answers.traits).toEqual(['glasses', 'prosthetic']);
    expect(answers.keep?.words).toBe('a chipped front tooth');
    const state = { ...EMPTY_STATE, answers };
    expect(compileItems(answers)).toEqual(finished.keepItems);
    expect(inStep(state, finished)).toBe(true);
  });
});
