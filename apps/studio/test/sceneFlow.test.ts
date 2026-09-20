import { describe, expect, it } from 'vitest';
import type { SceneReading, SceneStudioJob } from '../src/apiTypes.js';
import type { Turn } from '../src/conversation/question.js';
import {
  composerFor,
  type FlowArgs,
  judge,
  packSession,
  turnsFor,
  unpackSession,
} from '../src/create/scene/sceneFlowRules.js';
import { fillFrom } from '../src/create/scene/sceneRows.js';
import {
  type Answers,
  answeredIn,
  commit,
  compileDirection,
  deserializeSetup,
  EMPTY_SETUP,
  nextQuestion,
  PASSED,
  picturesOf,
  reduceSetup,
  type SetupAction,
  type SetupState,
  serializeSetup,
  setupDone,
  SPECS,
} from '../src/create/scene/sceneSetup.js';
import { EMPTY, reduce, seeded, type StudioState } from '../src/create/scene/sceneStudioRules.js';

const H = (c: string) => c.repeat(32);
const R = (over: Partial<SceneReading> = {}): SceneReading => ({
  name: 'Wet Basalt Shore',
  prompt: 'A wet basalt shelf at the waterline.',
  lighting: 'Low sunset',
  subject: 'product',
  description: 'A dark shore.',
  ...over,
});
const job = (over: Partial<SceneStudioJob>): SceneStudioJob => ({
  id: 'j1',
  brandId: 'b',
  kind: 'make',
  status: 'done',
  phase: null,
  startedAt: 't',
  phaseAt: 't',
  finishedAt: 't',
  reading: R(),
  coverage: [],
  hash: null,
  error: null,
  warnings: [],
  attachTo: null,
  ...over,
});

const guided: Answers = {
  source: { door: 'guided' },
  world: { pick: 'stone' },
  shot: { pick: 'top' },
};

const setupOf = (answers: Answers): SetupState => ({ ...EMPTY_SETUP, answers });
const args = (over: Partial<FlowArgs>): FlowArgs => ({
  setup: EMPTY_SETUP,
  studio: EMPTY,
  canDraw: true,
  uploading: 0,
  edit: null,
  editingName: false,
  ...over,
});
const keys = (T: Turn[]) => T.map((t) => (t.kind === 'question' ? `q:${t.question.id}` : `${t.kind}:${t.id}`));
const lastQ = (T: Turn[]) => {
  const t = T[T.length - 1];
  return t?.kind === 'question' ? t.question : null;
};
const read = (studio: StudioState, over: Partial<SceneStudioJob> = {}) =>
  [
    { type: 'inputs', place: 'x', pictures: [] },
    { type: 'started', id: 'j1', kind: 'make', since: 't' },
    { type: 'finished', job: job(over) },
  ].reduce((s, a) => reduce(s, a as any), studio);

describe('the setup', () => {
  it('asks the door first, then the rows in order', () => {
    expect(nextQuestion({})).toBe('source');
    expect(nextQuestion({ source: { door: 'guided' } })).toBe('world');
    expect(nextQuestion({ ...guided, shot: undefined })).toBe('shot');
    expect(nextQuestion(guided)).toBeNull();
    expect(setupDone(guided)).toBe(true);
  });

  it('asks for pictures on the picture door, and is given once they are handed over', () => {
    const a: Answers = { source: { door: 'photos' }, photos: { hashes: [H('a')], done: false } };
    expect(nextQuestion(a)).toBe('photos');
    expect(setupDone({ ...a, photos: { hashes: [H('a')], done: true } })).toBe(true);
    expect(picturesOf({ ...a, photos: { hashes: [H('a')], done: true } })).toEqual([H('a')]);
  });

  it('takes a sentence at the first question as the whole place', () => {
    const a: Answers = { source: { door: 'words', text: 'White cyclorama, hard flash' } };
    expect(setupDone(a)).toBe(true);
    expect(compileDirection(a)).toBe('White cyclorama, hard flash');
  });

  it('says the rows as one sentence, skipped ones left out and typed ones kept', () => {
    expect(compileDirection(guided)).toBe(
      'A sunlit niche of warm limestone and rough plaster, in hard afternoon sun, seen from directly overhead, looking straight down.',
    );
    const mixed = { ...guided, shot: { pick: PASSED }, world: { pick: 'water', words: 'at low tide' } };
    expect(compileDirection(mixed)).toBe(
      'A shoreline of wet dark rock and shallow turquoise water, in hard midday sun, at low tide.',
    );
    expect(compileDirection({ ...guided, world: { words: 'a hotel lobby' } })).toMatch(/^A hotel lobby, /);
  });

  it('takes back everything asked after an answer that changed, and nothing before it', () => {
    const next = commit(guided, { world: { pick: 'dark' } });
    expect(next.world).toEqual({ pick: 'dark' });
    expect(next.shot).toBeUndefined();
    expect(nextQuestion(next)).toBe('shot');
  });

  it('forgets the rows when the door changes to pictures', () => {
    const next = commit(guided, { source: { door: 'photos' } });
    expect(answeredIn(next)).toEqual(['source']);
  });

  it('keeps reopened pictures standing where they were asked while they change, and Cancel puts them back', () => {
    const a: Answers = { source: { door: 'photos' }, photos: { hashes: [H('a'), H('b')], done: true } };
    let s = reduceSetup(setupOf(a), { type: 'edit', id: 'photos' });
    s = reduceSetup(s, { type: 'photos', hashes: [H('a')] });
    expect(answeredIn(s.answers)).toContain('photos');
    expect(nextQuestion(s.answers)).toBeNull();
    s = reduceSetup(s, { type: 'cancel-edit' });
    expect(s.answers).toEqual(a);
    expect(s.editing).toBeNull();
    // handed over again, the new set is the answer
    s = reduceSetup(reduceSetup(s, { type: 'edit', id: 'photos' }), { type: 'photos', hashes: [H('c')] });
    s = reduceSetup(s, { type: 'answer', patch: { photos: { hashes: [H('c')], done: true } } });
    expect(picturesOf(s.answers)).toEqual([H('c')]);
    expect(s.held).toBeNull();
  });

  it('survives a reload, checked rather than trusted', () => {
    const s = reduceSetup(setupOf(guided), {
      type: 'aside',
      aside: { said: 'hi', reply: 'Hello.', q: 'world', at: '2026-09-19T00:00:00.000Z' },
    });
    const back = deserializeSetup(JSON.parse(JSON.stringify(serializeSetup(s))));
    expect(back?.answers).toEqual(guided);
    expect(back?.asides).toHaveLength(1);
    expect(deserializeSetup({ answers: { world: { pick: 'volcano' }, source: { door: 'guided' } } })?.answers).toEqual({
      source: { door: 'guided' },
    });
  });

  // every answer belongs to a question that exists, whatever order things happen in
  it.each([3, 17, 99])('keeps its answers sound through a random walk (seed %i)', (seed) => {
    let n = seed;
    const r = () => {
      n = (n * 1103515245 + 12345) & 0x7fffffff;
      return n / 0x7fffffff;
    };
    const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    let s: SetupState = EMPTY_SETUP;
    for (let i = 0; i < 1500; i++) {
      const act: SetupAction = pick<SetupAction>([
        { type: 'answer', patch: { source: { door: pick(['photos', 'guided', 'words'] as const), text: 'a shore' } } },
        { type: 'answer', patch: { [pick(['world', 'shot'])]: { pick: PASSED } } },
        { type: 'answer', patch: { world: { pick: 'colour', words: pick([undefined, 'a loft']) } } },
        { type: 'answer', patch: { photos: { hashes: [H('a')], done: r() < 0.5 } } },
        { type: 'photos', hashes: [H(pick(['a', 'b', 'c', 'd', 'e']))] },
        { type: 'edit', id: pick(['source', 'photos', 'world', 'shot'] as const) },
        { type: 'cancel-edit' },
      ]);
      s = reduceSetup(s, act);
      for (const k of Object.keys(s.answers)) {
        const spec = SPECS.find((x) => x.id === k);
        expect(spec?.applies(s.answers)).toBe(true);
      }
      if (s.editing) expect(answeredIn(s.answers)).toContain(s.editing);
      expect((s.answers.photos?.hashes.length ?? 0) <= 4).toBe(true);
    }
  });
});

describe('the conversation', () => {
  it('offers the pictures this person already made at the picture question, and asks for a file when there are none', () => {
    const setup = setupOf({ source: { door: 'photos' }, photos: { hashes: [], done: false } });
    const none = lastQ(turnsFor(args({ setup })));
    expect(none?.kind === 'photos' && none.suggest).toBeUndefined();

    const offered = lastQ(turnsFor(args({ setup, have: [H('a'), H('b')] })));
    expect(offered?.kind).toBe('photos');
    const row = offered?.kind === 'photos' ? offered.suggest : undefined;
    expect(row?.items.map((i) => i.hash)).toEqual([H('a'), H('b')]);
    // it says what is taken out of one, because a shot of theirs holds a
    // product and a person that a scene must never carry
    expect(row?.hint).toContain('the product and the person in it are not');
  });

  it('opens with the ask and the two doors, and a line that takes a sentence and pictures', () => {
    const T = turnsFor(args({}));
    expect(keys(T)).toEqual(['you:intent', 'q:source']);
    const c = composerFor(args({}), lastQ(T));
    expect(c.target).toEqual({ kind: 'source' });
    expect(c.attach).toBe(true);
  });

  it('keeps each answer under its line, with a pencil, and asks the next row', () => {
    const T = turnsFor(args({ setup: setupOf({ source: { door: 'guided' }, world: { pick: 'colour' } }) }));
    expect(keys(T)).toEqual([
      'you:intent',
      'scenri:asked-source',
      'you:source',
      'scenri:asked-world',
      'you:world',
      'q:shot',
    ]);
    expect(T.find((t) => t.kind === 'you' && t.id === 'world')).toMatchObject({ text: 'Colour field', editable: true });
    expect(composerFor(args({}), lastQ(T)).target).toEqual({ kind: 'row', id: 'shot' });
  });

  it('reopens an answer in place, and leaves the question on the floor standing', () => {
    const setup = { ...setupOf({ source: { door: 'guided' }, world: { pick: 'colour' } }), editing: 'world' as const };
    const T = turnsFor(args({ setup }));
    const i = keys(T).indexOf('q:world');
    expect(i).toBe(4);
    expect(T[i].kind === 'question' && T[i].question.reopened).toBe(true);
    expect(keys(T).at(-1)).toBe('q:shot');
  });

  it('reads the place back before anything is drawn, with one Draw', () => {
    const studio = read(EMPTY);
    const T = turnsFor(args({ setup: setupOf(guided), studio }));
    const q = lastQ(T);
    expect(q?.id).toBe('agree-0');
    expect(q?.kind === 'confirm' && q.quote).toContain(R().prompt);
    expect(q?.kind === 'confirm' && q.options.map((o) => o.id)).toEqual(['draw']);
    expect(composerFor(args({ setup: setupOf(guided), studio }), q).target).toEqual({ kind: 'add' });
  });

  it('says the pictures were read, on the picture door, and asks what to keep or ignore', () => {
    const a: Answers = { source: { door: 'photos' }, photos: { hashes: [H('a')], done: true } };
    const studio = read(EMPTY);
    const T = turnsFor(args({ setup: setupOf(a), studio }));
    const q = lastQ(T);
    expect(q?.prompt).toMatch(/pictures/);
    expect(composerFor(args({ setup: setupOf(a), studio }), q).placeholder).toMatch(/keep or ignore/);
  });

  it('saves words straight away where nothing can draw', () => {
    const studio = read(EMPTY);
    const q = lastQ(turnsFor(args({ setup: setupOf(guided), studio, canDraw: false })));
    expect(q?.kind === 'confirm' && q.options.map((o) => o.id)).toEqual(['use']);
  });

  it('asks the name while the first picture draws, and decides once it lands', () => {
    let studio = read(EMPTY);
    studio = reduce(studio, { type: 'started', id: 'j2', kind: 'again', since: 't' });
    const drawing = turnsFor(args({ setup: setupOf(guided), studio }));
    expect(keys(drawing).slice(-2)).toEqual(['you:pending-j2', 'q:name']);
    expect(composerFor(args({ setup: setupOf(guided), studio }), lastQ(drawing)).target).toEqual({ kind: 'name' });
    studio = reduce(studio, { type: 'finished', job: job({ id: 'j2', kind: 'again', hash: H('b') }) });
    const landed = turnsFor(args({ setup: setupOf(guided), studio }));
    expect(keys(landed).slice(-3)).toEqual(['you:draw-1', 'scenri:pic-1', 'q:decide-1']);
    const q = lastQ(landed);
    expect(q?.kind === 'confirm' && q.options.map((o) => o.id)).toEqual(['use', 'again']);
    expect(composerFor(args({ setup: setupOf(guided), studio }), q).target).toEqual({ kind: 'change' });
  });

  it('shows every picture with a way to put it back, and the one standing as the one standing', () => {
    let studio = read(EMPTY, { hash: H('a') });
    studio = reduce(studio, { type: 'started', id: 'j2', kind: 'change', ask: 'warmer', since: 't' });
    studio = reduce(studio, { type: 'finished', job: job({ id: 'j2', kind: 'change', hash: H('b') }) });
    const T = turnsFor(args({ setup: setupOf(guided), studio }));
    const pics = T.filter((t) => t.kind === 'scenri' && t.thumb);
    expect(pics.map((p) => p.kind === 'scenri' && [p.thumb, p.current, !!p.restore])).toEqual([
      [H('a'), false, true],
      [H('b'), true, false],
    ]);
    expect(keys(T)).toContain('you:ask-1');
  });

  it('asks to read again when a changed place could not be read', () => {
    let studio = read(EMPTY, { hash: H('a') });
    studio = reduce(studio, { type: 'inputs', place: 'y', pictures: [] });
    studio = reduce(studio, { type: 'error', text: 'quota' });
    const q = lastQ(turnsFor(args({ setup: setupOf(guided), studio, stale: true })));
    expect(q?.id).toBe('retry');
  });

  it('opens a saved scene at its record, spending nothing and asking nothing of the setup', () => {
    const seed = seeded({ place: 'a shore', pictures: [], reading: R(), hash: H('a'), name: 'Shore' });
    const T = turnsFor(args({ studio: seed, edit: { name: 'Shore' } }));
    expect(keys(T)[0]).toBe('scenri:edit-open');
    expect(lastQ(T)?.id).toBe('decide-0');
    expect(lastQ(T)?.kind === 'confirm' && lastQ(T)?.kind === 'confirm' ? (lastQ(T) as any).options[0].label : '').toBe(
      'Save changes',
    );
    // it was named when it was made: nothing asks for a name "while it draws", and the words match the button
    expect(keys(T)).not.toContain('scenri:asked-name');
    expect(keys(T)).not.toContain('you:name');
    expect(lastQ(T)?.prompt).toBe('Here is Shore. Save it, or change something.');
  });

  it('keeps what was said at a question under it, and says the rest before the one on the floor', () => {
    const setup: SetupState = {
      ...setupOf({ source: { door: 'guided' }, world: { pick: 'colour' } }),
      asides: [
        { said: 'hi', reply: 'Hello.', q: 'world', at: '1' },
        { said: 'what now?', reply: 'Tap one.', q: 'shot', at: '2' },
      ],
    };
    const k = keys(turnsFor(args({ setup })));
    expect(k.indexOf('you:aside-said-1')).toBeGreaterThan(k.indexOf('scenri:asked-world'));
    expect(k.indexOf('you:aside-said-1')).toBeLessThan(k.indexOf('you:world'));
    expect(k.indexOf('you:aside-said-2')).toBe(k.length - 3);
  });
});

describe('what a sentence is', () => {
  it.each([
    ['a quiet concrete gallery at dusk', 'source', null],
    ['white cyclorama', 'source', null],
    ['hi', 'source', 'greeting'],
    ['what do i do?', 'source', 'help'],
    ['blue hour', 'row', null],
    ['raw brick', 'row', null],
    ['thanks', 'row', 'greeting'],
  ] as const)('%s at the %s is %s', (text, at, kind) => {
    expect(judge(text, at)).toBe(kind);
  });
});

describe('the session', () => {
  it('comes back whole after a reload: the answers and every version', () => {
    let studio = read(EMPTY, { hash: H('a') });
    studio = reduce(studio, { type: 'started', id: 'j2', kind: 'change', ask: 'warmer', since: 't' });
    studio = reduce(studio, { type: 'finished', job: job({ id: 'j2', kind: 'change', hash: H('b') }) });
    studio = reduce(studio, { type: 'name', text: 'Tide Shelf' });
    const back = unpackSession(packSession(setupOf(guided), studio));
    expect(back?.setup?.answers).toEqual(guided);
    expect(back?.studio).toEqual(studio);
  });

  it('starts a new conversation from anything it cannot read', () => {
    expect(unpackSession('{nope')).toBeNull();
    expect(unpackSession(JSON.stringify({ v: 1 }))).toBeNull();
    expect(unpackSession(JSON.stringify({ v: 2, setup: {}, studio: { versions: [] } }))?.studio).toBeNull();
  });
});

describe('a phrase typed at the first question', () => {
  it('answers the questions it names, so they are not asked again', () => {
    expect(fillFrom('overhead, in a studio')).toEqual({ world: 'colour', shot: 'top' });
    expect(fillFrom('golden stone wall')).toEqual({ world: 'stone' });
    expect(fillFrom('close up')).toEqual({ shot: 'close' });
  });

  it('takes the longest cue, so a phrase inside a phrase does not win', () => {
    expect(fillFrom('a close up of it').shot).toBe('close');
    expect(fillFrom('low angle').shot).toBe('ground');
  });

  it('matches whole words only', () => {
    // "orange" must not be found inside "storage", nor "close" inside "closet"
    expect(fillFrom('a storage closet')).toEqual({});
    expect(fillFrom('nothing it knows about')).toEqual({});
  });
});
