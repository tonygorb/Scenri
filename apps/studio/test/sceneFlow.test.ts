import { describe, expect, it } from 'vitest';
import type { SceneReading, SceneStudioJob } from '../src/apiTypes.js';
import type { Turn } from '../src/conversation/question.js';
import {
  composerFor,
  type FlowArgs,
  judge,
  packSession,
  placesTheyMade,
  questionFor,
  turnsFor,
  unpackSession,
} from '../src/create/scene/sceneFlowRules.js';
import { followUps, intentOf, known } from '../src/create/scene/sceneIntent.js';
import { fillFrom, ROW_ORDER, ROWS } from '../src/create/scene/sceneRows.js';
import {
  type Answers,
  answeredIn,
  answerPatch,
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
const haveOf = (c: string, alt: string) => ({ hash: H(c), alt });
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
  light: { pick: 'golden' },
  stage: { pick: 'plinth' },
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
    expect(nextQuestion({ ...guided, light: undefined, stage: undefined })).toBe('light');
    expect(nextQuestion({ ...guided, stage: undefined })).toBe('stage');
    expect(nextQuestion(guided)).toBeNull();
    expect(setupDone(guided)).toBe(true);
  });

  it('asks for pictures on the picture door, and is given once they are handed over', () => {
    const a: Answers = { source: { door: 'photos' }, photos: { hashes: [H('a')], done: false } };
    expect(nextQuestion(a)).toBe('photos');
    expect(setupDone({ ...a, photos: { hashes: [H('a')], done: true } })).toBe(true);
    expect(picturesOf({ ...a, photos: { hashes: [H('a')], done: true } })).toEqual([H('a')]);
  });

  it('takes a sentence that decides the place as the whole place, and asks nothing more', () => {
    const a: Answers = { source: { door: 'words', text: 'White cyclorama, hard flash, top-down product photography' } };
    expect(nextQuestion(a)).toBeNull();
    expect(setupDone(a)).toBe(true);
    expect(compileDirection(a)).toBe('White cyclorama, hard flash, top-down product photography');
  });

  it('asks only what a sentence left open, and never the camera', () => {
    // the place and the light are said: how the subject sits is the one open decision
    const two: Answers = { source: { door: 'words', text: 'White cyclorama, hard flash' } };
    expect(nextQuestion(two)).toBe('stage');
    const done = commit(two, { stage: { pick: PASSED } });
    expect(setupDone(done)).toBe(true);
    expect(compileDirection(done)).toBe('White cyclorama, hard flash');

    // a material and a register, nothing about light or placement: those two, in that order
    const warm: Answers = { source: { door: 'words', text: 'luxury product photography in warm stone' } };
    expect(nextQuestion(warm)).toBe('light');
    const lit = commit(warm, { light: { pick: 'golden' } });
    expect(nextQuestion(lit)).toBe('stage');
    const sat = commit(lit, { stage: { pick: 'plinth' } });
    expect(nextQuestion(sat)).toBeNull();
    const golden = ROWS.light.options.find((o) => o.id === 'golden')!.words;
    const plinth = ROWS.stage.options.find((o) => o.id === 'plinth')!.words;
    expect(compileDirection(sat)).toBe(`luxury product photography in warm stone, ${golden}, ${plinth}.`);
    // no row asks where the camera is
    expect(SPECS.map((x) => x.id)).not.toContain('shot');
  });

  it('asks where it is when a sentence gives only a feeling', () => {
    const a: Answers = { source: { door: 'words', text: 'something calm and expensive for a skincare launch' } };
    expect(nextQuestion(a)).toBe('world');
    const placed = commit(a, { world: { pick: 'stone' } });
    // a world with its own light asks whether to keep it, like the guided door
    expect(nextQuestion(placed)).toBe('light');
  });

  it('lets the sentence decide over anything a tapped world implies', () => {
    // the sentence says the light; the world tapped after it does not add its own
    const a: Answers = {
      source: { door: 'words', text: 'under hard on-camera flash, shot from above, on a plinth' },
      world: { pick: 'stone' },
    };
    expect(nextQuestion(a)).toBeNull();
    const d = compileDirection(a);
    expect(d.startsWith('under hard on-camera flash, shot from above, on a plinth,')).toBe(true);
    expect(d).not.toContain(ROWS.world.options.find((o) => o.id === 'stone')!.light!);
  });

  it('asks again from the sentence when the sentence changes', () => {
    const a = commit({ source: { door: 'words', text: 'a cold shore' } }, { light: { pick: 'golden' } });
    const changed = commit(a, { source: { door: 'words', text: 'a cold shore at blue hour' } });
    expect(changed.light).toBeUndefined();
    expect(nextQuestion(changed)).toBe('stage');
  });

  it('says the rows as one sentence, skipped ones left out and typed ones kept', () => {
    expect(compileDirection(guided)).toBe(
      'A niche of warm limestone and rough plaster, in low golden-hour sun, long warm shadows, the subject standing on a simple plinth or ledge in the space.',
    );
    const mixed = { ...guided, world: { pick: 'water', words: 'at low tide' } };
    expect(compileDirection(mixed)).toBe(
      'A shoreline of wet dark rock and shallow turquoise water, at low tide, in low golden-hour sun, long warm shadows, the subject standing on a simple plinth or ledge in the space.',
    );
    // a light passed over leaves the world lit the way its own card is
    expect(compileDirection({ ...guided, light: { pick: PASSED } })).toBe(
      'A niche of warm limestone and rough plaster, in hard afternoon sun, the subject standing on a simple plinth or ledge in the space.',
    );
    expect(compileDirection({ ...guided, world: { words: 'a hotel lobby' } })).toMatch(/^A hotel lobby, /);
  });

  it('takes back everything asked after an answer that changed, and nothing before it', () => {
    const next = commit(guided, { world: { pick: 'dark' } });
    expect(next.world).toEqual({ pick: 'dark' });
    expect(next.light).toBeUndefined();
    expect(next.stage).toBeUndefined();
    expect(nextQuestion(next)).toBe('light');
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
        { type: 'answer', patch: { [pick(['world', 'light', 'stage'])]: { pick: PASSED } } },
        { type: 'answer', patch: { world: { pick: 'colour', words: pick([undefined, 'a loft']) } } },
        { type: 'answer', patch: { photos: { hashes: [H('a')], done: r() < 0.5 } } },
        { type: 'photos', hashes: [H(pick(['a', 'b', 'c', 'd', 'e']))] },
        { type: 'edit', id: pick(['source', 'photos', 'world', 'light', 'stage'] as const) },
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

describe('eight worlds', () => {
  it('has eight, each with a card and cues of its own', () => {
    expect(ROWS.world.options).toHaveLength(8);
    for (const o of ROWS.world.options) {
      expect(o.card).toBeTruthy();
      expect(o.cues?.length).toBeGreaterThan(0);
    }
    const ids = ROWS.world.options.map((o) => o.id);
    expect(new Set(ids).size).toBe(8);
    const cues = ROWS.world.options.flatMap((o) => o.cues ?? []);
    expect(new Set(cues).size).toBe(cues.length);
  });
});

describe('the light row says what the world already gave it', () => {
  it('asks plainly, with no hint, before a world is chosen', () => {
    const q = questionFor('light', setupOf({ source: { door: 'guided' } }), false, 0);
    expect(q.kind === 'swatches' && q.prompt).toBe('What light?');
    expect(q.kind === 'swatches' && q.skip).toBe('Skip');
  });

  it("names the world's own light in the prompt and offers to keep it, once a world is chosen", () => {
    const a: Answers = { source: { door: 'guided' }, world: { pick: 'stone' } };
    const q = questionFor('light', setupOf(a), false, 0);
    expect(q.kind === 'swatches' && q.prompt).toBe(
      'This world is already lit in hard afternoon sun. Keep it, or choose another.',
    );
    expect(q.kind === 'swatches' && q.skip).toBe('Keep it');
  });

  it('reads a kept world light back as Keep it, not Skip', () => {
    const a: Answers = {
      source: { door: 'guided' },
      world: { pick: 'stone' },
      light: { pick: PASSED },
    };
    const T = turnsFor(args({ setup: setupOf(a) }));
    expect(T.find((t) => t.kind === 'you' && t.id === 'light')).toMatchObject({ text: 'Keep it' });
  });

  it('says the world is a starting point, and only worlds are a grid', () => {
    const a: Answers = { source: { door: 'guided' }, world: { pick: 'stone' } };
    const world = questionFor('world', setupOf({ source: { door: 'guided' } }), false, 0);
    const light = questionFor('light', setupOf(a), false, 0);
    const stage = questionFor('stage', setupOf(a), false, 0);
    expect(world.kind === 'swatches' && world.hint).toBe("Choose a starting world. You'll personalise it next.");
    expect(world.kind === 'swatches' && world.skip).toBe('Skip');
    expect(world.kind === 'swatches' && world.layout).toBe('grid');
    expect(light.kind === 'swatches' && light.layout).toBeUndefined();
    expect(stage.kind).toBe('swatches');
    expect(stage.kind === 'swatches' && stage.layout).toBeUndefined();
    expect(stage.kind === 'swatches' && stage.row.options.every((o) => o.card)).toBe(true);
    expect(stage.kind === 'swatches' && stage.skip).toBe('Skip');
    expect(stage.kind === 'swatches' && stage.row.options.map((o) => o.id)).toEqual([
      'nest',
      'plinth',
      'bed',
      'hands',
      'floor',
      'lean',
    ]);
  });

  it('never asks where the camera is: each shot, and the examples of the scene, decide that', () => {
    expect(ROW_ORDER).toEqual(['world', 'light', 'stage']);
    // staging is how the subject sits in the set; none of its answers is a camera
    for (const id of ['above', 'below', 'wide']) expect(ROWS.stage.options.map((o) => o.id)).not.toContain(id);
    const afterStage: Answers = {
      source: { door: 'guided' },
      world: { pick: 'stone' },
      light: { pick: 'golden' },
      stage: { pick: 'plinth' },
    };
    expect(nextQuestion(afterStage)).toBeNull();
    expect(setupDone(afterStage)).toBe(true);
    const keysAfter = keys(turnsFor(args({ setup: setupOf(afterStage) })));
    expect(keysAfter).not.toContain('q:shot');
    expect(keysAfter).not.toContain('scenri:asked-shot');
    expect(keysAfter).not.toContain('you:shot');
    // nothing about the camera reaches the place's words
    expect(compileDirection(afterStage)).not.toMatch(/overhead|ground level|eye level|seen /);
  });

  it('still lets an explicit pick or a typed light override the world default', () => {
    // tapped: golden-hour wins over stone's own hard afternoon sun
    expect(compileDirection(guided)).toContain('in low golden-hour sun');
    // typed with no tap: the words alone win
    const typed: Answers = { ...guided, light: { words: 'candlelight only' } };
    expect(compileDirection(typed)).toContain('candlelight only');
    expect(compileDirection(typed)).not.toContain('hard afternoon sun');
  });

  it('says a lone world is a starting direction, not the final picture', () => {
    const a: Answers = {
      source: { door: 'guided' },
      world: { pick: 'stone' },
      light: { pick: PASSED },
      stage: { pick: PASSED },
    };
    expect(compileDirection(a)).toContain('in hard afternoon sun');
    expect(compileDirection(a)).toContain('starting direction, not a picture to reproduce');
    expect(compileDirection(guided)).not.toContain('starting direction');
  });
});

describe('staging personalises the world', () => {
  it('answers only the sit: a camera inside a pick is not a second answer in the thread', () => {
    const nest = answerPatch('stage', { kind: 'choice', id: 'nest' }, { source: { door: 'guided' } });
    expect(nest).toEqual({ stage: { pick: 'nest' } });
    const hands = answerPatch('stage', { kind: 'choice', id: 'hands' }, { source: { door: 'guided' } });
    expect(hands).toEqual({ stage: { pick: 'hands' } });
    const floor = answerPatch('stage', { kind: 'choice', id: 'floor' }, { source: { door: 'guided' } });
    expect(floor).toEqual({ stage: { pick: 'floor' } });
  });

  it('does not ask the camera after a sit, and does not write a silent camera answer', () => {
    const next = commit({ source: { door: 'guided' } }, { stage: { pick: 'hands' } });
    expect(next.stage).toEqual({ pick: 'hands' });
    expect(nextQuestion(next)).toBe('world');
    expect(answeredIn({ ...next, world: { pick: 'stone' }, light: { pick: 'golden' } })).not.toContain('shot');
  });

  it('takes staging back when the world changes', () => {
    const next = commit(guided, { world: { pick: 'dark' } });
    expect(next.stage).toBeUndefined();
    expect(next.light).toBeUndefined();
  });
});

describe('the conversation', () => {
  it('offers the pictures this person already made at the picture question, and asks for a file when there are none', () => {
    const setup = setupOf({ source: { door: 'photos' }, photos: { hashes: [], done: false } });
    const none = lastQ(turnsFor(args({ setup })));
    expect(none?.kind === 'photos' && none.suggest).toBeUndefined();

    const offered = lastQ(turnsFor(args({ setup, have: [haveOf('a', 'Shore'), haveOf('b', 'Hall')] })));
    expect(offered?.kind).toBe('photos');
    const row = offered?.kind === 'photos' ? offered.suggest : undefined;
    expect(row?.items.map((i) => i.hash)).toEqual([H('a'), H('b')]);
    expect(row?.hint).toContain('Product shots stay out');
    expect(row?.more).toBe('See all 2 scenes');
    expect(row?.search).toBe('Find a scene');
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
      'q:light',
    ]);
    expect(T.find((t) => t.kind === 'you' && t.id === 'world')).toMatchObject({ text: 'Colour field', editable: true });
    expect(composerFor(args({}), lastQ(T)).target).toEqual({ kind: 'row', id: 'light' });
  });

  it('reopens an answer in place, and leaves the question on the floor standing', () => {
    const setup = { ...setupOf({ source: { door: 'guided' }, world: { pick: 'colour' } }), editing: 'world' as const };
    const T = turnsFor(args({ setup }));
    const i = keys(T).indexOf('q:world');
    expect(i).toBe(4);
    expect(T[i].kind === 'question' && T[i].question.reopened).toBe(true);
    expect(keys(T).at(-1)).toBe('q:light');
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
        { said: 'what now?', reply: 'Tap one.', q: 'light', at: '2' },
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
    expect(fillFrom('golden stone wall')).toEqual({ world: 'stone', light: 'golden' });
    expect(fillFrom('on a plinth, in a studio')).toEqual({ world: 'colour', stage: 'plinth' });
    // a camera it names is no row's answer: the reader keeps it as the place's camera tendency
    expect(fillFrom('overhead, in a studio')).toEqual({ world: 'colour' });
    expect(fillFrom('close up')).toEqual({});
  });

  it('takes the longest cue, so a phrase inside a phrase does not win', () => {
    expect(fillFrom('a cool dusk').light).toBe('blue');
    expect(fillFrom('by a still pool').world).toBe('dark');
  });

  it('matches whole words only', () => {
    // "orange" must not be found inside "storage", nor "close" inside "closet"
    expect(fillFrom('a storage closet')).toEqual({});
    expect(fillFrom('nothing it knows about')).toEqual({});
  });

  it('maps plaster and linen to the new worlds, and never plaster back to stone', () => {
    expect(fillFrom('a plaster room')).toEqual({ world: 'plaster' });
    expect(fillFrom('folded linen')).toEqual({ world: 'linen' });
    expect(fillFrom('raw concrete interior')).toEqual({ world: 'plaster' });
    expect(fillFrom('plaster')).not.toMatchObject({ world: 'stone' });
  });

  it('names a staging pick from the words, so that row is not asked again', () => {
    expect(fillFrom('on a plinth')).toEqual({ stage: 'plinth' });
    expect(fillFrom("in someone's hands")).toEqual({ stage: 'hands' });
    expect(fillFrom('lying in the material')).toEqual({ stage: 'bed' });
  });
});

describe('what is worth reading', () => {
  const guided = { source: { door: 'guided' as const } };

  it('does not spend a reading on nothing when every row was passed', () => {
    const passed = {
      ...guided,
      world: { pick: PASSED },
      light: { pick: PASSED },
      stage: { pick: PASSED },
    };
    // the questions are over, so nothing is on the floor
    expect(nextQuestion(passed)).toBeNull();
    // but there is nothing to read, and a reading costs a real call
    expect(setupDone(passed)).toBe(false);
  });

  it('is ready the moment one of them says something, tapped or typed', () => {
    expect(
      setupDone({
        ...guided,
        world: { pick: 'water' },
        light: { pick: PASSED },
        stage: { pick: PASSED },
      }),
    ).toBe(true);
    expect(
      setupDone({
        ...guided,
        world: { pick: PASSED },
        light: { pick: PASSED },
        stage: { words: 'on a stack of old books' },
      }),
    ).toBe(true);
  });

  it('holds for the other two doors too', () => {
    expect(setupDone({ source: { door: 'words', text: '   ' } })).toBe(false);
    expect(setupDone({ source: { door: 'words', text: 'a cold shore' } })).toBe(false);
    expect(
      setupDone({ source: { door: 'words', text: 'a cold shore' }, light: { pick: PASSED }, stage: { pick: PASSED } }),
    ).toBe(true);
    expect(setupDone({ source: { door: 'photos' }, photos: { hashes: [], done: true } })).toBe(false);
  });
});

describe('the words door', () => {
  it('takes a place in one or two words, because a place is not a person', () => {
    // these used to come back as "that did not read as a place", which is the
    // one thing this door exists not to say
    expect(judge('moon', 'source')).toBeNull();
    expect(judge('cathedral', 'source')).toBeNull();
    expect(judge('brutalist car park', 'source')).toBeNull();
  });

  it('still refuses what is not an answer at all', () => {
    expect(judge('123', 'source')).toBe('nonsense');
    expect(judge('hi', 'source')).toBe('greeting');
    expect(judge('what can you do?', 'source')).toBe('question');
    expect(judge('start over', 'source')).toBe('nav');
  });
});

describe('places they already made', () => {
  it('takes only scenes with a picture, newest first, and leaves shots out', () => {
    expect(
      placesTheyMade([
        { name: 'Old shore', preview: `asset:${H('a')}` },
        { name: 'Words only' },
        { name: 'A can', preview: `shot:${H('b')}` },
        { name: 'New hall', preview: `asset:${H('c')}` },
      ]),
    ).toEqual([
      { hash: H('c'), alt: 'New hall' },
      { hash: H('a'), alt: 'Old shore' },
    ]);
  });
});

describe('stop is never a dead end', () => {
  it('does not stand the prompt card until the read-back has landed', () => {
    const studio = reduce(EMPTY, { type: 'inputs', place: compileDirection(guided), pictures: [] });
    const working = reduce(studio, { type: 'started', id: 'j1', kind: 'make', since: 't' });
    const T = turnsFor(args({ setup: setupOf(guided), studio: working }));
    expect(lastQ(T)).toBeNull();
    expect(T.some((t) => t.kind === 'question' && t.question.quoteLabel === 'What your shots are told')).toBe(false);
    expect(
      T.some((t) => t.kind === 'scenri' && 'text' in t && String(t.text).includes('Treat this as a starting')),
    ).toBe(false);
    expect(T.some((t) => t.id === 'reading-j1')).toBe(false);
  });

  it('offers Try again after a stopped read, and the line still takes a place', () => {
    let studio = reduce(EMPTY, { type: 'inputs', place: 'a shore', pictures: [] });
    studio = reduce(studio, { type: 'started', id: 'j1', kind: 'make', since: 't' });
    studio = reduce(studio, { type: 'finished', job: job({ status: 'cancelled', reading: null, hash: null }) });
    expect(studio.error).toBe('Stopped before the place was read. Read it again, or say it differently.');
    const q = lastQ(turnsFor(args({ setup: setupOf(guided), studio, stale: true })));
    expect(q?.id).toBe('retry');
    expect(q?.prompt).toBe('Stopped before the place was read. Read it again, or say it differently.');
    expect(composerFor(args({ setup: setupOf(guided), studio, stale: true }), q).target).toEqual({ kind: 'source' });
  });
});

describe('what a sentence already decides', () => {
  it('reads the four decisions off whole words', () => {
    expect(known(intentOf('white cyclorama, hard flash, top-down product photography'))).toEqual([
      'world',
      'light',
      'camera',
    ]);
    expect(known(intentOf('luxury product photography in warm stone'))).toEqual(['world']);
    expect(known(intentOf('a pearl resting on wet sand at golden hour, macro'))).toEqual([
      'world',
      'light',
      'stage',
      'camera',
    ]);
    expect(known(intentOf('calm and expensive'))).toEqual([]);
  });

  it('does not mistake a material for a light', () => {
    expect(intentOf('warm stone').light).toBe(false);
    expect(intentOf('soft linen folds').light).toBe(false);
    expect(intentOf('dark marble').light).toBe(false);
  });

  it('asks two things at most, world first, and nothing once three are said', () => {
    expect(followUps(intentOf('calm and expensive'))).toEqual(['world', 'light']);
    expect(followUps(intentOf('a sunlit beach'))).toEqual(['stage']);
    expect(followUps(intentOf('hard flash, from above, on a plinth'))).toEqual(['world']);
    expect(followUps(intentOf('white cyclorama, hard flash, top-down'))).toEqual([]);
  });
});
