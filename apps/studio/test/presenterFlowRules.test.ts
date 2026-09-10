import { describe, expect, it } from 'vitest';
import type { Question, Turn } from '../src/conversation/question.ts';
import { type CreationState, EMPTY_STATE, NO_DRAFT, reduce } from '../src/create/presenter/creationState.ts';
import {
  PROMPT,
  activeQuestion,
  answerPatch,
  compileDirection,
  compileKeep,
  compileRefs,
  composerFor,
  editCost,
  flowContext,
  turnsFor,
} from '../src/create/presenter/presenterFlowRules.ts';
import type { Answers } from '../src/create/presenter/presenterQuestions.ts';
import { type DraftLike, emptySlot } from '../src/create/presenter/presenterStudioRules.ts';

const state = (answers: Answers, over: Partial<CreationState> = {}): CreationState => ({
  ...EMPTY_STATE,
  answers,
  ...over,
});

const draft = (over: Partial<DraftLike> = {}): DraftLike => ({
  source: 'synthetic',
  name: '',
  direction: 'a woman in their 30s',
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

const approved = (hash: string) => ({ ...emptySlot(), status: 'approved' as const, hash });

const turns = (s: CreationState, d: DraftLike | null = null, canGenerate = true, failed: string | null = null) =>
  turnsFor({ state: s, draft: d, canGenerate, failed });
const keys = (T: Turn[]) => T.map((t) => (t.kind === 'question' ? `q:${t.question.id}` : `${t.kind}:${t.id}`));
const open = (T: Turn[]): Question | null => activeQuestion(T);

const TAPPED: Answers = {
  source: { door: 'scratch', via: 'taps' },
  'look-who': 'woman',
  'look-age': '30s',
  'look-hair': 'brown',
  'look-length': 'long',
  'look-skin': 'olive',
  'look-build': 'lean',
};

describe('the transcript is a function of state', () => {
  it('opens with the intent and one question, and the composer is the sentence', () => {
    const T = turns(state({}));
    expect(keys(T)).toEqual(['you:intent', 'q:source']);
    expect(composerFor(open(T), state({}), null, 'portrait').placeholder).toBe('Describe them, or choose above');
  });

  it('from scratch: the look is asked one row at a time, each answer under its own line', () => {
    let a: Answers = { source: { door: 'scratch', via: 'taps' } };
    const T0 = turns(state(a));
    expect(keys(T0)).toEqual(['you:intent', 'scenri:asked-source', 'you:source', 'q:look-who']);
    // the line of an answered question is quiet: read once, never said again
    expect(T0[1]).toMatchObject({ kind: 'scenri', quiet: true, text: PROMPT.source });
    for (const [id, v, next] of [
      ['look-who', 'woman', 'look-age'],
      ['look-age', '30s', 'look-hair'],
      ['look-hair', 'brown', 'look-length'],
      ['look-length', 'long', 'look-skin'],
      ['look-skin', 'olive', 'look-build'],
    ] as const) {
      a = { ...a, [id]: v };
      const T = turns(state(a));
      expect(keys(T).at(-1)).toBe(`q:${next}`);
      expect(keys(T)).toContain(`you:${id}`);
      // a tap question owns the answer: the composer says where it is
      expect(composerFor(open(T), state(a), null, 'portrait').off).toBe('Tap one above.');
    }
    a = { ...a, 'look-build': 'lean' };
    // the rows done, what is always true of them is the one question that opens more
    expect(keys(turns(state(a))).at(-1)).toBe('q:traits');
    const T = turns(state({ ...a, traits: [] }));
    const q = open(T);
    expect(q?.id).toBe('agree');
    expect(q?.kind === 'confirm' && q.prompt).toBe(
      'A woman in their 30s with long brown hair, olive skin, a lean build. Shall I draw them?',
    );
    expect(q?.kind === 'confirm' && q.options.map((o) => o.label)).toEqual(['Draw them', 'Add a detail']);
    // the swatch questions know who is being drawn
    const who = open(turns(state({ source: { door: 'scratch', via: 'taps' }, 'look-who': 'man' })));
    expect(who?.kind === 'swatches' && who.cast).toBe('man');
  });

  it('the details chosen each ask their own question, in the table order, then read back as exchanges', () => {
    const a: Answers = { ...TAPPED, traits: ['tattoo', 'glasses'] };
    // the face before the body, whatever order they were tapped
    expect(open(turns(state(a)))?.id).toBe('trait-glasses');
    const b: Answers = { ...a, 'trait-glasses': { words: 'rimless frames with thin temples', refs: [] } };
    expect(open(turns(state(b)))?.id).toBe('trait-tattoo');
    const c: Answers = { ...b, 'trait-tattoo': { words: 'a solid blackwork tattoo', refs: ['h-ink'] } };
    expect(open(turns(state(c)))?.id).toBe('trait-tattoo-where');
    const d: Answers = { ...c, 'trait-tattoo-where': 'on their left forearm' };
    const T = turns(state(d));
    expect(keys(T).slice(-9)).toEqual([
      'scenri:asked-traits',
      'you:traits',
      'scenri:asked-trait-glasses',
      'you:trait-glasses',
      'scenri:asked-trait-tattoo',
      'you:trait-tattoo',
      'scenri:asked-trait-tattoo-where',
      'you:trait-tattoo-where',
      'q:agree',
    ]);
    const said = (id: string) => T.find((t) => t.kind === 'you' && t.id === id) as Extract<Turn, { kind: 'you' }>;
    expect(said('traits').text).toBe('Glasses and Tattoo');
    expect(said('trait-glasses').text).toBe('Rimless');
    expect(said('trait-tattoo-where').text).toBe('Left forearm');
    // a picture of the thing itself can be attached, and rides with the answer
    const tq = open(turns(state(b)));
    expect(tq?.kind === 'choice' && tq.attach).toBe('Add a reference');
    const withPicture = T.find((t) => t.kind === 'you' && t.id === 'trait-tattoo');
    expect(withPicture?.kind === 'you' && withPicture.photos).toEqual(['h-ink']);
    const without = T.find((t) => t.kind === 'you' && t.id === 'trait-glasses');
    expect(without?.kind === 'you' && without.photos).toBeUndefined();
  });

  it('a question open again stands where its answer was, with the answer in it, and nothing else asks', () => {
    const a: Answers = {
      ...TAPPED,
      traits: ['glasses'],
      'trait-glasses': { words: 'tortoiseshell acetate frames', refs: [] },
    };
    const T = turns(state(a, { editing: 'look-hair' }));
    const k = keys(T);
    expect(k).toContain('q:look-hair');
    expect(k).not.toContain('you:look-hair');
    // where the answer was: under its own line, between the age and the length
    expect(k.indexOf('q:look-hair')).toBe(k.indexOf('you:look-age') + 2);
    expect(k[k.indexOf('q:look-hair') - 1]).toBe('scenri:asked-look-hair');
    expect(k[k.indexOf('q:look-hair') + 1]).toBe('scenri:asked-look-length');
    // everything after it is still there, and the question the conversation is
    // on still stands: taking it away would pull the ground from under a
    // reader at the bottom of a long conversation
    expect(k).toContain('you:trait-glasses');
    expect(k.at(-1)).toBe('q:agree');
    const q = T.find((t) => t.kind === 'question' && t.question.id === 'look-hair');
    expect(q?.kind === 'question' && q.question.reopened).toBe(true);
    expect(q?.kind === 'question' && q.question.kind === 'swatches' && q.question.given).toBe('brown');
    // a chooser open again carries what was chosen
    const T2 = turns(state(a, { editing: 'traits' }));
    const q2 = T2.find((t) => t.kind === 'question' && t.question.id === 'traits');
    expect(q2?.kind === 'question' && q2.question.kind === 'choice' && q2.question.given).toEqual(['glasses']);
    // a sentence is rewritten in place
    const w: Answers = {
      source: { door: 'scratch', via: 'typed' },
      describe: 'a tall woman in her 40s with a shaved head',
    };
    const T3 = turns(state(w, { editing: 'describe' }));
    const you = T3.find((t) => t.kind === 'you' && t.id === 'describe');
    expect(you?.kind === 'you' && you.editing).toBe(true);
    // the sentence is rewritten where it stands, and the question the
    // conversation is on stays where it is
    expect(keys(T3)).toContain('you:describe');
    expect(keys(T3).at(-1)).toBe('q:traits');
    expect(composerFor(open(T3), state(w, { editing: 'describe' }), null, 'portrait').off).toBe(
      'Finish the change above.',
    );
  });

  it('a typed sentence answers the door and the description together, asks its follow-up once, then the details', () => {
    const thin: Answers = { source: { door: 'scratch', via: 'typed' }, describe: 'tall with a hat' };
    const T = turns(state(thin));
    // the sentence answered the first question, under that question's line
    expect(keys(T)).toEqual(['you:intent', 'scenri:asked-describe', 'you:describe', 'q:gaps']);
    expect(T[1]).toMatchObject({ text: PROMPT.source });
    const withGaps: Answers = { ...thin, gaps: { who: 'woman', age: '40s', build: 'lean' } };
    expect(open(turns(state(withGaps)))?.id).toBe('traits');
    // nothing left to ask: the draft starts itself, so no question stands
    const done: Answers = { ...withGaps, traits: [] };
    expect(open(turns(state(done)))).toBeNull();
    // unless starting it failed, in which case Retry stands
    expect(open(turns(state(done), null, true, 'engine offline'))?.id).toBe('retry');
    // a full sentence has no follow-up
    const full: Answers = {
      source: { door: 'scratch', via: 'words' },
      describe: 'a woman in her 30s with a lean build',
    };
    expect(open(turns(state(full)))?.id).toBe('traits');
    expect(keys(turns(state(full))).slice(0, 4)).toEqual([
      'you:intent',
      'scenri:asked-source',
      'you:source',
      'scenri:asked-describe',
    ]);
  });

  it('from scratch with no engine: the setup line, nothing drawn', () => {
    const T = turns(state({ source: { door: 'scratch', via: 'taps' } }), null, false);
    expect(open(T)?.id).toBe('noengine');
  });

  it('from photos: the photo block until a draft exists, then the photos as an answer, then what stays', () => {
    const p: Answers = { source: { door: 'photos', via: 'taps' }, photos: { hashes: ['h1', 'h2'], attested: true } };
    const T = turns(state(p));
    const q = open(T);
    expect(q?.id).toBe('photos');
    expect(q?.kind === 'photos' && q.hashes).toEqual(['h1', 'h2']);
    expect(q?.kind === 'photos' && q.attest?.checked).toBe(true);
    // the draft holds them: the photos are an answer with the pictures in it
    const d = draft({
      source: 'photos',
      sources: ['h1', 'h2'],
      views: { ...draft().views, portrait: { ...approved('h1'), origin: 'photo' } },
    });
    const T2 = turns(state(p), d);
    const you = T2.find((t) => t.kind === 'you' && t.id === 'photos');
    expect(you?.kind === 'you' && you.photos).toEqual(['h1', 'h2']);
    // the face stands: what stays is asked, after the read of the photographs
    const k = keys(T2);
    expect(k.indexOf('q:traits')).toBeGreaterThan(k.indexOf('scenri:coverage'));
    expect(open(T2)?.kind === 'choice' && (open(T2) as Extract<Question, { kind: 'choice' }>).skip).toBe(
      'Nothing to add',
    );
    // answered, the exchange stands in the same place and the name is asked while the set draws
    const answered: Answers = {
      ...p,
      traits: ['glasses'],
      'trait-glasses': { words: 'thin black rectangular metal frames', refs: [] },
    };
    const drawing = draft({ ...d, keep: 'thin black rectangular metal frames', activeView: 'front', stage: 'drawing' });
    const T3 = turns(state(answered), drawing);
    const k3 = keys(T3);
    expect(k3.indexOf('you:trait-glasses')).toBeGreaterThan(k3.indexOf('scenri:coverage'));
    expect(k3.at(-1)).toBe('q:name');
  });

  it('photos with no engine end in the honest save, and are not asked what stays', () => {
    const p: Answers = { source: { door: 'photos', via: 'taps' }, photos: { hashes: ['h1'], attested: true } };
    const d = draft({
      source: 'photos',
      name: 'Noa',
      sources: ['h1'],
      views: { ...draft().views, portrait: { ...approved('h1'), origin: 'photo' } },
    });
    expect(open(turns(state(p), d, false))?.id).toBe('blind');
  });
});

describe('the record once a face is drawn', () => {
  const a: Answers = { ...TAPPED, traits: [] };

  it('asks the name while the face draws, and keeps the answer under that line', () => {
    const d = draft({
      activeView: 'portrait',
      stage: 'drawing',
      views: { ...draft().views, portrait: { ...emptySlot(), status: 'generating' } },
    });
    expect(open(turns(state(a), d))?.id).toBe('name');
    const named = draft({ ...d, name: 'Maren' });
    const T = turns(state(a), named);
    expect(keys(T).slice(-3)).toEqual(['scenri:drawing-face', 'scenri:asked-name', 'you:name']);
    // the name is rewritten in place, and it costs nothing
    const T2 = turns(state(a, { editing: 'name' }), named);
    const you = T2.find((t) => t.kind === 'you' && t.id === 'name');
    expect(you?.kind === 'you' && you.editing).toBe(true);
    expect(editCost('name', named)).toBe('metadata');
  });

  it('the face candidate is the one decision before the set', () => {
    const d = draft({ views: { ...draft().views, portrait: { ...emptySlot(), status: 'candidate', hash: 'p1' } } });
    const q = open(turns(state(a), d));
    expect(q?.id).toBe('identity');
    expect(q?.kind === 'confirm' && q.options.map((o) => o.id)).toEqual(['use', 'again', 'change']);
    expect(composerFor(q, state(a), d, 'portrait').action).toBe('Refine');
  });

  it('the set builds without a question, then offers the extras once, then the save', () => {
    const core = draft({
      name: 'Maren',
      views: { ...draft().views, portrait: approved('p1'), front: approved('f1'), 'three-quarter': approved('t1') },
    });
    expect(open(turns(state(a), core))?.id).toBe('extras');
    expect(open(turns(state(a, { extrasDeclined: true }), core))?.id).toBe('save');
    // the setup exchanges are all still there, pencils and all
    const k = keys(turns(state(a, { extrasDeclined: true }), core));
    for (const id of ['look-who', 'look-build', 'traits']) expect(k).toContain(`you:${id}`);
    // an answer changed under a drawn face is asked about; the door starts over
    expect(editCost('look-hair', core)).toBe('redraw');
    expect(editCost('traits', core)).toBe('redraw');
    expect(editCost('source', core)).toBe('start-over');
    expect(editCost('look-hair', null)).toBe('plain');
    // the answer opens where it stands, and the question the conversation is on
    // stays exactly where it was
    const T = turns(state(a, { extrasDeclined: true, editing: 'look-build' }), core);
    expect(keys(T).at(-1)).toBe('q:save');
    expect(keys(T)).toContain('q:look-build');
    expect(keys(T)).not.toContain('you:look-build');
  });

  it('a failed view asks for a retry and touches nothing else', () => {
    const d = draft({
      name: 'Maren',
      views: { ...draft().views, portrait: approved('p1'), front: { ...emptySlot(), error: 'engine offline' } },
    });
    const q = open(turns(state(a), d));
    expect(q?.id).toBe('retry');
    expect(q?.kind === 'confirm' && q.prompt).toContain('engine offline');
  });
});

describe('what a tap means', () => {
  it('maps every block to its answer, and a photograph action to none', () => {
    expect(answerPatch('source', { kind: 'choice', id: 'photos' }, {})).toEqual({
      source: { door: 'photos', via: 'taps' },
    });
    expect(answerPatch('look-hair', { kind: 'swatches', picks: { hair: 'auburn' } }, {})).toEqual({
      'look-hair': 'auburn',
    });
    expect(answerPatch('look-build', { kind: 'skip' }, {})).toEqual({ 'look-build': 'either' });
    expect(answerPatch('gaps', { kind: 'choices', picks: { who: 'man' } }, {})).toEqual({ gaps: { who: 'man' } });
    expect(answerPatch('gaps', { kind: 'skip' }, {})).toEqual({ gaps: 'skipped' });
    // the chooser keeps the table's order, whatever order the chips were tapped in
    expect(answerPatch('traits', { kind: 'choices', picks: { tattoo: 'on', glasses: 'on' } }, {})).toEqual({
      traits: ['glasses', 'tattoo'],
    });
    expect(answerPatch('traits', { kind: 'skip' }, {})).toEqual({ traits: [] });
    // a detail's words keep the pictures already attached to it
    expect(
      answerPatch(
        'trait-tattoo',
        { kind: 'choice', id: 'a solid blackwork tattoo' },
        { 'trait-tattoo': { refs: ['h'] } },
      ),
    ).toEqual({ 'trait-tattoo': { words: 'a solid blackwork tattoo', refs: ['h'] } });
    expect(answerPatch('trait-tattoo-where', { kind: 'choice', id: 'on their hand' }, {})).toEqual({
      'trait-tattoo-where': 'on their hand',
    });
    expect(answerPatch('photos', { kind: 'photos', action: { type: 'attest', checked: true } }, {})).toBeNull();
  });

  it('compiles the rows into the sentence, the details into what stays, and the pictures by detail', () => {
    const a: Answers = {
      ...TAPPED,
      'look-hair': '#7f3fbf',
      traits: ['glasses', 'tattoo'],
      'trait-glasses': { words: 'thin black rectangular metal frames', refs: ['h-frames'] },
      'trait-tattoo': { words: 'a small geometric line tattoo', refs: [] },
      'trait-tattoo-where': 'on their right forearm',
      keep: 'a red thread bracelet',
    };
    expect(compileDirection(a)).toBe('a woman in their 30s with long dyed purple hair, olive skin, a lean build');
    expect(compileKeep(a)).toBe(
      'thin black rectangular metal frames, a small geometric line tattoo on their right forearm, a red thread bracelet',
    );
    expect(compileRefs(a)).toEqual({ glasses: ['h-frames'] });
    // a detail chosen but not yet answered is not in the sentence
    expect(compileKeep({ ...TAPPED, traits: ['scar'] })).toBe('');
    // the typed path folds the follow-up into the sentence without repeating it
    const typed: Answers = {
      source: { door: 'scratch', via: 'typed' },
      describe: 'tall with a hat',
      gaps: { who: 'woman', age: '40s', build: 'lean' },
    };
    expect(compileDirection(typed)).toBe('a woman in her 40s, tall with a hat, lean build');
  });
});

describe('the composer follows the state', () => {
  it('is handed one question at a time when a tap question is answered in words', () => {
    const s = state({ ...TAPPED, 'look-hair': undefined }, { saying: 'look-hair' });
    const c = composerFor(open(turns(s)), s, null, 'portrait');
    expect(c.placeholder).toBe('Their hair colour, in words or a swatch');
    expect(c.color).toBe(true);
    const t = state({ ...TAPPED, traits: ['scar'] }, { saying: 'trait-scar' });
    expect(composerFor(open(turns(t)), t, null, 'portrait').label).toBe('Describe the scar');
    const k = state({ ...TAPPED, traits: [] }, { saying: 'keep' });
    expect(composerFor(open(turns(k)), k, null, 'portrait').label).toBe('What should stay the same about them');
    // and stands down at the read-back otherwise
    const r = state({ ...TAPPED, traits: [] });
    expect(composerFor(open(turns(r)), r, null, 'portrait').off).toBe('Choose above.');
  });

  it('turns into the refinement field once the face is used, and asks the name while a view draws', () => {
    const core = draft({
      views: { ...draft().views, portrait: approved('p1') },
      activeView: 'front',
      stage: 'drawing',
    });
    const s = state({ ...TAPPED, traits: [] });
    // the name is still open while the set draws, so the composer is the name
    expect(composerFor(open(turns(s, core)), s, core, 'front').label).toBe('Their name');
    const named = draft({
      ...core,
      name: 'Maren',
      activeView: null,
      stage: 'idle',
      views: { ...core.views, front: approved('f1'), 'three-quarter': approved('t1') },
    });
    const done = state({ ...TAPPED, traits: [] }, { extrasDeclined: true });
    const q = open(turns(done, named));
    expect(q?.id).toBe('save');
    expect(composerFor(q, done, named, 'front').placeholder).toBe('Change this view: full body');
  });
});

describe('what was said in passing', () => {
  it('stays under the question it interrupted, and a waiting sentence stands last', () => {
    let s = reduce(state({ source: { door: 'scratch', via: 'taps' } }), {
      type: 'aside',
      aside: { said: 'hi', reply: 'Hi.', q: 'look-who', at: '2026-01-01T00:00:01Z' },
    });
    // open: the aside follows the question
    expect(keys(turns(s)).slice(-3)).toEqual([
      'q:look-who',
      'you:aside-said-2026-01-01T00:00:01Z',
      'scenri:aside-reply-2026-01-01T00:00:01Z',
    ]);
    // answered: it sits between the line and the answer
    s = reduce(s, { type: 'answer', patch: { 'look-who': 'woman' }, ctx: NO_DRAFT });
    expect(keys(turns(s)).slice(3, 7)).toEqual([
      'scenri:asked-look-who',
      'you:aside-said-2026-01-01T00:00:01Z',
      'scenri:aside-reply-2026-01-01T00:00:01Z',
      'you:look-who',
    ]);
    // a sentence with nothing of a person in it waits on its own question
    const w = reduce(state({}), { type: 'unsure', unsure: { said: 'blue', q: 'source', at: '2026-01-01T00:00:02Z' } });
    expect(open(turns(w))?.id).toBe('unsure');
  });

  it('the draft the setup sees is the small part of it that decides a question', () => {
    const d = draft({ source: 'photos', keep: 'x', views: { ...draft().views, portrait: approved('h1') } });
    expect(flowContext(d, true)).toEqual({
      draft: { source: 'photos', stage: 'idle', keep: 'x', views: { portrait: { status: 'approved' } } },
      canGenerate: true,
    });
    expect(flowContext(null, false)).toEqual({ draft: null, canGenerate: false });
  });
});
