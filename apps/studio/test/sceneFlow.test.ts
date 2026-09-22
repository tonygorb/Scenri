import { describe, expect, it } from 'vitest';
import type { SceneReading, SceneStudioJob } from '../src/apiTypes.js';
import type { Turn } from '../src/conversation/question.js';
import {
  composerFor,
  type FlowArgs,
  judge,
  type SetArgs,
  packSession,
  placesTheyMade,
  questionFor,
  turnsFor,
  unpackSession,
} from '../src/create/scene/sceneFlowRules.js';
import { followUps, intentOf, known } from '../src/create/scene/sceneIntent.js';
import {
  fillFrom,
  optionOf,
  optionsFor,
  ROW_ORDER,
  ROWS,
  SUGGESTED_IDEA,
  swatchRow,
} from '../src/create/scene/sceneRows.js';
import { DRAWN_WORLDS, IN_THE_PLACE, WORLD_IDS } from '../src/create/scene/sceneWorldRows.js';
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
import {
  EMPTY,
  keptAsDraft,
  PLACE_MAX,
  reduce,
  seeded,
  type StudioState,
  unsaved,
} from '../src/create/scene/sceneStudioRules.js';

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
  surface: { pick: 'stone-travertine' },
  light: { pick: 'stone-golden' },
  signature: { pick: 'stone-vines' },
};
/** What a direction made only of taps ends on. */
const START =
  'Treat this as a starting direction, not a picture to reproduce: keep the material language and the character of the light, and invent a specific original arrangement.';
/** An option's own words, so a test reads what a tap hands the reader. */
const said = (row: 'world' | 'surface' | 'light' | 'signature', id: string) => optionOf(row, id)!.words;

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
    expect(nextQuestion({ ...guided, surface: undefined, light: undefined, signature: undefined })).toBe('surface');
    expect(nextQuestion({ ...guided, light: undefined, signature: undefined })).toBe('light');
    expect(nextQuestion({ ...guided, signature: undefined })).toBe('signature');
    expect(nextQuestion(guided)).toBeNull();
    expect(setupDone(guided)).toBe(true);
  });

  it('asks for pictures on the picture door, and is given once they are handed over', () => {
    const a: Answers = { source: { door: 'photos' }, photos: { hashes: [H('a')], done: false } };
    expect(nextQuestion(a)).toBe('photos');
    expect(setupDone({ ...a, photos: { hashes: [H('a')], done: true } })).toBe(true);
    expect(picturesOf({ ...a, photos: { hashes: [H('a')], done: true } })).toEqual([H('a')]);
  });

  it('asks a sentence that decides the place only what would make it unforgettable', () => {
    const a: Answers = { source: { door: 'words', text: 'White cyclorama, hard flash, top-down product photography' } };
    expect(nextQuestion(a)).toBe('signature');
    // passing it is not "none": the reading is asked to invent one for the place
    const passed = commit(a, { signature: { pick: PASSED } });
    expect(nextQuestion(passed)).toBeNull();
    expect(setupDone(passed)).toBe(true);
    expect(compileDirection(passed)).toBe(
      `White cyclorama, hard flash, top-down product photography, ${SUGGESTED_IDEA}, ${IN_THE_PLACE}.`,
    );
    // one that already names its idea is asked nothing
    const whole: Answers = { source: { door: 'words', text: 'White cyclorama, hard flash, confetti frozen mid air' } };
    expect(nextQuestion(whole)).toBeNull();
  });

  it('asks only what a sentence left open, and never the camera or how the subject sits', () => {
    // the place and the light are said: what it is made of, then its idea
    const two: Answers = { source: { door: 'words', text: 'White cyclorama, hard flash' } };
    expect(nextQuestion(two)).toBe('surface');
    const done = commit(commit(two, { surface: { pick: PASSED } }), { signature: { pick: PASSED } });
    expect(setupDone(done)).toBe(true);
    expect(compileDirection(done)).toBe(`White cyclorama, hard flash, ${SUGGESTED_IDEA}, ${IN_THE_PLACE}.`);

    // a material names the world and what it is made of: its light, then its idea
    const warm: Answers = { source: { door: 'words', text: 'luxury product photography in warm stone' } };
    expect(nextQuestion(warm)).toBe('light');
    const lit = commit(warm, { light: { pick: 'golden' } });
    expect(nextQuestion(lit)).toBe('signature');
    const whole = commit(lit, { signature: { pick: 'change' } });
    expect(nextQuestion(whole)).toBeNull();
    expect(compileDirection(whole)).toBe(
      `luxury product photography in warm stone, ${said('light', 'golden')}, ${said('signature', 'change')}, ${IN_THE_PLACE}.`,
    );
    // no row asks where the camera is, or how the subject sits: each shot says both
    expect(SPECS.map((x) => x.id)).not.toContain('shot');
    expect(SPECS.map((x) => x.id)).not.toContain('stage');
  });

  it('asks where it is when a sentence gives only a feeling', () => {
    const a: Answers = { source: { door: 'words', text: 'something calm and expensive for a skincare launch' } };
    expect(nextQuestion(a)).toBe('world');
    const placed = commit(a, { world: { pick: 'stone' } });
    // two of the essentials at most, then the idea
    expect(nextQuestion(placed)).toBe('surface');
    expect(nextQuestion(commit(placed, { surface: { pick: PASSED } }))).toBe('signature');
  });

  it('lets the sentence decide over anything a tapped world implies', () => {
    // the sentence says the light; the world tapped after it does not add its own
    const a: Answers = {
      source: { door: 'words', text: 'under hard on-camera flash, shot from above, on a plinth' },
      world: { pick: 'stone' },
    };
    // three things said: only the world was asked, and the idea still is
    expect(nextQuestion(a)).toBe('signature');
    const d = compileDirection(a);
    expect(d.startsWith('under hard on-camera flash, shot from above, on a plinth,')).toBe(true);
    expect(d).not.toContain(ROWS.world.options.find((o) => o.id === 'stone')!.light!);
  });

  it('asks again from the sentence when the sentence changes', () => {
    const a = commit({ source: { door: 'words', text: 'a cold shore' } }, { light: { pick: 'golden' } });
    const changed = commit(a, { source: { door: 'words', text: 'a cold shore of wet rocks' } });
    expect(changed.light).toBeUndefined();
    // the rocks say what it is made of, so the light is asked again, then its idea
    expect(nextQuestion(changed)).toBe('light');
  });

  it('says the rows as one sentence, skipped ones left out and typed ones kept', () => {
    const rest = `${said('surface', 'stone-travertine')}, ${said('light', 'stone-golden')}, ${said('signature', 'stone-vines')}`;
    // the guard on the idea is said once, at the end, never inside the option
    expect(compileDirection(guided)).toBe(
      `A niche of warm limestone and rough plaster, ${rest}, ${IN_THE_PLACE}. ${START}`,
    );
    const mixed = { ...guided, world: { pick: 'water', words: 'at low tide' } };
    expect(compileDirection(mixed)).toBe(
      `A shoreline of wet dark rock and shallow turquoise water, at low tide, ${rest}, ${IN_THE_PLACE}. ${START}`,
    );
    // words of their own sit with their idea, ahead of the guard, so a
    // qualifier reads as part of the idea and not of the guard
    expect(compileDirection({ ...guided, signature: { pick: 'stone-vines', words: 'in deep teal' } })).toBe(
      `A niche of warm limestone and rough plaster, ${said('surface', 'stone-travertine')}, ${said('light', 'stone-golden')}, ${said('signature', 'stone-vines')}, in deep teal, ${IN_THE_PLACE}. ${START}`,
    );
    // a light passed over leaves the world lit the way its own card is; a
    // surface passed keeps what the world is made of
    expect(compileDirection({ ...guided, surface: { pick: PASSED }, light: { pick: PASSED } })).toBe(
      `A niche of warm limestone and rough plaster, in hard afternoon sun, ${said('signature', 'stone-vines')}, ${IN_THE_PLACE}. ${START}`,
    );
    // and a world left alone is only a starting direction
    expect(
      compileDirection({
        source: { door: 'guided' },
        world: { pick: 'stone' },
        surface: { pick: PASSED },
        light: { pick: PASSED },
        signature: { pick: PASSED },
      }),
    ).toBe(
      `A niche of warm limestone and rough plaster, in hard afternoon sun, ${SUGGESTED_IDEA}, ${IN_THE_PLACE}. ${START}`,
    );
    expect(compileDirection({ ...guided, world: { words: 'a hotel lobby' } })).toMatch(/^A hotel lobby, /);
  });

  it('takes back everything asked after an answer that changed, and nothing before it', () => {
    const next = commit(guided, { world: { pick: 'dark' } });
    expect(next.world).toEqual({ pick: 'dark' });
    expect(next.surface).toBeUndefined();
    expect(next.light).toBeUndefined();
    expect(next.signature).toBeUndefined();
    expect(nextQuestion(next)).toBe('surface');
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
        { type: 'answer', patch: { [pick(['world', 'surface', 'light', 'signature'])]: { pick: PASSED } } },
        { type: 'answer', patch: { world: { pick: 'colour', words: pick([undefined, 'a loft']) } } },
        { type: 'answer', patch: { photos: { hashes: [H('a')], done: r() < 0.5 } } },
        { type: 'photos', hashes: [H(pick(['a', 'b', 'c', 'd', 'e']))] },
        { type: 'edit', id: pick(['source', 'photos', 'world', 'surface', 'light', 'signature'] as const) },
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

describe('the rows after the world belong to the world', () => {
  it('offers each world its own four surfaces, lights and ideas, and the general rows only without one', () => {
    for (const w of WORLD_IDS)
      for (const row of ['surface', 'light', 'signature'] as const) {
        const own = optionsFor(row, w);
        expect(own, `${w} ${row}`).toHaveLength(4);
        own.forEach((o, i) => {
          expect(o.id.startsWith(`${w}-`), o.id).toBe(true);
          expect(o.card).toBe(`scene-${w}-${row}-${i + 1}`);
        });
      }
    expect(optionsFor('surface', 'colour').map((o) => o.label)).toEqual([
      'Glossy lacquer',
      'Matte paper',
      'Frosted acrylic',
      'Flocked velvet',
    ]);
    expect(optionsFor('surface', undefined)).toBe(ROWS.surface.options);
  });

  it('asks them as the question on the floor, read back by their own words', () => {
    const a: Answers = { source: { door: 'guided' }, world: { pick: 'colour' } };
    const q = questionFor('surface', setupOf(a), false, 0);
    expect(q.kind === 'swatches' && q.row.options.map((o) => o.id)[0]).toBe('colour-lacquer');
    // a world's own answer reads back by its own label, and compiles by its own words
    const lit: Answers = { ...a, surface: { pick: 'colour-paper' } };
    const T = turnsFor(args({ setup: setupOf(lit) }));
    expect(T.find((t) => t.kind === 'you' && t.id === 'surface')).toMatchObject({ text: 'Matte paper' });
    expect(compileDirection(lit)).toContain(said('surface', 'colour-paper'));
    // passing the idea, in the guided door, is the suggestion
    const idea = questionFor('signature', setupOf(lit), false, 0);
    expect(idea.kind === 'swatches' && idea.skip).toBe('Suggest one');
    // the world's own row is its own pictures
    expect(swatchRow('surface', 'colour').options.map((o) => o.card)).toEqual([
      'scene-colour-surface-1',
      'scene-colour-surface-2',
      'scene-colour-surface-3',
      'scene-colour-surface-4',
    ]);
  });
});

describe('the light row says what the world already gave it', () => {
  it('asks plainly, with no hint, before a world is chosen', () => {
    const q = questionFor('light', setupOf({ source: { door: 'guided' } }), false, 0);
    expect(q.kind === 'swatches' && q.prompt).toBe('What does the light do?');
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
    const surface = questionFor('surface', setupOf(a), false, 0);
    expect(world.kind === 'swatches' && world.hint).toBe("Choose a starting world. You'll personalise it next.");
    expect(world.kind === 'swatches' && world.skip).toBe('Skip');
    expect(world.kind === 'swatches' && world.layout).toBe('grid');
    expect(light.kind === 'swatches' && light.layout).toBeUndefined();
    // after a world, passing its surface keeps what the world is made of
    expect(surface.kind === 'swatches' && surface.skip).toBe("Keep the world's own");
    // a drawn world's rows are pictures, every option of them
    for (const q of [light, surface])
      expect(q.kind === 'swatches' && q.row.options.every((o) => !!o.card), q.id).toBe(true);
    // every world is drawn, and every row of every world is pictures
    expect([...DRAWN_WORLDS].sort()).toEqual([...WORLD_IDS].sort());
    for (const w of WORLD_IDS)
      for (const id of ['surface', 'light', 'signature'] as const) {
        const q = questionFor(id, setupOf({ source: { door: 'guided' }, world: { pick: w } }), false, 0);
        expect(q.kind === 'swatches' && q.row.options.every((o) => !!o.card), `${w} ${id}`).toBe(true);
      }
    // and a row shows pictures only once every one of its options has one:
    // the general rows a typed sentence falls back to have none, so are chips
    const typed: Answers = { source: { door: 'words', text: 'a quiet gallery' } };
    const surfaceTyped = questionFor('surface', setupOf(typed), false, 0);
    expect(surfaceTyped.kind === 'swatches' && surfaceTyped.row.options.some((o) => o.card)).toBe(false);
  });

  it('never asks where the camera is or how the subject sits: each shot, and the examples, show that', () => {
    expect(ROW_ORDER).toEqual(['world', 'surface', 'light', 'signature']);
    expect(nextQuestion(guided)).toBeNull();
    expect(setupDone(guided)).toBe(true);
    const keysAfter = keys(turnsFor(args({ setup: setupOf(guided) })));
    for (const k of ['q:shot', 'scenri:asked-shot', 'you:shot', 'q:stage', 'scenri:asked-stage', 'you:stage'])
      expect(keysAfter).not.toContain(k);
    // nothing about the camera, or about how the subject sits, reaches the place's words
    expect(compileDirection(guided)).not.toMatch(/overhead|ground level|eye level|seen |plinth|standing on|held in/);
    // a conversation kept from before still opens: its staging answer is simply gone
    const kept = deserializeSetup({
      answers: { source: { door: 'guided' }, world: { pick: 'stone' }, stage: { pick: 'plinth' } },
    });
    expect(kept?.answers).toEqual({ source: { door: 'guided' }, world: { pick: 'stone' } });
    expect(nextQuestion(kept!.answers)).toBe('surface');
  });

  it('still lets an explicit pick or a typed light override the world default', () => {
    // tapped: the low golden sun wins over stone's own hard afternoon sun
    expect(compileDirection(guided)).toContain(said('light', 'stone-golden'));
    expect(compileDirection(guided)).not.toContain('hard afternoon sun');
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
    };
    expect(compileDirection(a)).toContain('in hard afternoon sun');
    expect(compileDirection(a)).toContain('starting direction, not a picture to reproduce');
    // Every guided direction says it, taps only or with words of their own:
    // eight worlds times four options a row is 512 sentences, and a few typed
    // words do not stop two people from getting the same arrangement. The
    // cards show what a choice means; the reading invents the place.
    expect(compileDirection(guided)).toContain('starting direction');
    expect(compileDirection({ ...guided, signature: { pick: 'stone-vines', words: 'in deep teal' } })).toContain(
      'starting direction',
    );
    expect(compileDirection({ ...guided, world: { pick: 'stone', words: 'at dusk' } })).toMatch(
      /at dusk.*starting direction/,
    );
    // a typed sentence is the person's own place: it is not told to invent one
    expect(compileDirection({ source: { door: 'words', text: 'my grandmother kitchen at dawn' } })).not.toContain(
      'starting direction',
    );
  });

  it('offers three to eight real choices in every row, none repeated, and the same shape in every world', () => {
    // Variable on purpose: a row offers what changes the scene and no more,
    // so no row is padded to match another. The bounds keep it a choice
    // (not a yes or no) and keep it scannable (not a catalogue).
    const check = (opts: { id: string; label: string; words: string }[], where: string) => {
      expect(opts.length, where).toBeGreaterThanOrEqual(3);
      expect(opts.length, where).toBeLessThanOrEqual(8);
      for (const key of ['id', 'label', 'words'] as const)
        expect(new Set(opts.map((o) => o[key])).size, `${where} ${key}`).toBe(opts.length);
    };
    for (const row of ROW_ORDER) check(ROWS[row].options as any, `general ${row}`);
    const shape = (w: string) => (['surface', 'light', 'signature'] as const).map((r) => optionsFor(r, w).length);
    for (const w of WORLD_IDS) {
      for (const r of ['surface', 'light', 'signature'] as const) check(optionsFor(r, w) as any, `${w} ${r}`);
      expect(shape(w), w).toEqual(shape(WORLD_IDS[0]));
    }
  });

  it('never composes a direction the record would cut off', () => {
    // A tapped direction is composed, not typed: when the cap was sized for a
    // sentence somebody wrote, four taps plus a few words of their own ran
    // past it and the end was lost in silence. Every combination must fit,
    // with room left for words of their own.
    const ROOM = 'x'.repeat(120);
    let worst = 0;
    for (const w of ROWS.world.options) {
      for (const s of optionsFor('surface', w.id)) {
        for (const l of optionsFor('light', w.id)) {
          for (const g of [...optionsFor('signature', w.id), { id: PASSED }]) {
            const a: Answers = {
              source: { door: 'guided' },
              world: { pick: w.id },
              surface: { pick: s.id },
              light: { pick: l.id },
              signature: { pick: g.id, words: ROOM },
            };
            worst = Math.max(worst, compileDirection(a).length);
          }
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(PLACE_MAX);
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
      'q:surface',
    ]);
    expect(T.find((t) => t.kind === 'you' && t.id === 'world')).toMatchObject({ text: 'Colour field', editable: true });
    expect(composerFor(args({}), lastQ(T)).target).toEqual({ kind: 'row', id: 'surface' });
  });

  it('reopens an answer in place, and leaves the question on the floor standing', () => {
    const setup = { ...setupOf({ source: { door: 'guided' }, world: { pick: 'colour' } }), editing: 'world' as const };
    const T = turnsFor(args({ setup }));
    const i = keys(T).indexOf('q:world');
    expect(i).toBe(4);
    expect(T[i].kind === 'question' && T[i].question.reopened).toBe(true);
    expect(keys(T).at(-1)).toBe('q:surface');
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
    // how the subject sits is no row's answer either: the reader keeps what the sentence says
    expect(fillFrom('on a plinth, in a studio')).toEqual({ world: 'colour' });
    // a camera it names is no row's answer: the reader keeps it as the place's camera tendency
    expect(fillFrom('overhead, in a studio')).toEqual({ world: 'colour' });
    expect(fillFrom('close up')).toEqual({});
  });

  it('takes the longest cue, so a phrase inside a phrase does not win', () => {
    expect(fillFrom('soft window light').light).toBe('window');
    expect(fillFrom('under a long shadow').light).toBe('shadow');
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
});

describe('what is worth reading', () => {
  const guided = { source: { door: 'guided' as const } };

  it('does not spend a reading on nothing when every row was passed', () => {
    const passed = {
      ...guided,
      world: { pick: PASSED },
      surface: { pick: PASSED },
      light: { pick: PASSED },
      signature: { pick: PASSED },
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
        surface: { pick: PASSED },
        light: { pick: PASSED },
        signature: { pick: PASSED },
      }),
    ).toBe(true);
    expect(
      setupDone({
        ...guided,
        world: { pick: PASSED },
        surface: { pick: PASSED },
        light: { pick: PASSED },
        signature: { words: 'a single red thread running through it' },
      }),
    ).toBe(true);
  });

  it('holds for the other two doors too', () => {
    expect(setupDone({ source: { door: 'words', text: '   ' } })).toBe(false);
    expect(setupDone({ source: { door: 'words', text: 'a cold shore' } })).toBe(false);
    expect(
      setupDone({
        source: { door: 'words', text: 'a cold shore' },
        surface: { pick: PASSED },
        light: { pick: PASSED },
        signature: { pick: PASSED },
      }),
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
  it('reads the decisions off whole words', () => {
    expect(known(intentOf('white cyclorama, hard flash, top-down product photography'))).toEqual([
      'world',
      'light',
      'camera',
    ]);
    // a material names the world and what it is made of
    expect(known(intentOf('luxury product photography in warm stone'))).toEqual(['world', 'surface']);
    expect(known(intentOf('a pearl resting on wet sand at golden hour, macro'))).toEqual([
      'world',
      'surface',
      'light',
      'stage',
      'camera',
    ]);
    // the idea that makes a place unforgettable, in the words that say one
    expect(intentOf('a concrete hall with mist lying low').signature).toBe(true);
    expect(intentOf('wax dripping down a steel wall').signature).toBe(true);
    expect(known(intentOf('calm and expensive'))).toEqual([]);
  });

  it('does not mistake a material for a light', () => {
    expect(intentOf('warm stone').light).toBe(false);
    expect(intentOf('soft linen folds').light).toBe(false);
    expect(intentOf('dark marble').light).toBe(false);
  });

  it('asks two of the essentials at most, world first, and always the idea a sentence left out', () => {
    expect(followUps(intentOf('calm and expensive'))).toEqual(['world', 'surface', 'signature']);
    expect(followUps(intentOf('a sunlit beach'))).toEqual(['surface', 'signature']);
    expect(followUps(intentOf('a cold shore'))).toEqual(['surface', 'light', 'signature']);
    // three things said: only a missing world, and the idea
    expect(followUps(intentOf('hard flash, from above, on a plinth'))).toEqual(['world', 'signature']);
    expect(followUps(intentOf('white cyclorama, hard flash, top-down'))).toEqual(['signature']);
    // a sentence with its own idea is asked nothing it already said
    expect(followUps(intentOf('white cyclorama, hard flash, top-down, confetti frozen mid air'))).toEqual([]);
  });
});

describe('after Use: nothing is drawn until it is asked for', () => {
  const used = () => {
    let s = read(EMPTY, { hash: H('a') });
    s = reduce(s, { type: 'name', text: 'Tide Shelf' });
    return reduce(s, { type: 'saved', id: 'us-1' });
  };
  const tile = (role: 'hero' | 'close' | 'hands', state: 'shown' | 'drawing' | 'failed', c = 'b') =>
    state === 'shown'
      ? { role, state, hash: H(c), url: `/api/images/${H(c)}` }
      : state === 'failed'
        ? { role, state, error: 'the engine returned no picture' }
        : { role, state };
  /** A set as it stands after the two were asked for and drew: nothing left to offer. */
  const set = (over: Partial<SetArgs> = {}): SetArgs => ({
    tiles: [],
    running: false,
    read: true,
    who: 'product',
    noSubject: false,
    missing: ['hands', 'angle', 'bold'],
    first: [],
    stale: false,
    finish: 'Open scene',
    ...over,
  });
  /** Saved, with the two the first press would draw still uncounted against anything. */
  const offered = (over: Partial<SetArgs> = {}): SetArgs => set({ first: ['hero', 'close'], ...over });
  const drew = () => reduce(used(), { type: 'set-drawn' });
  const flow = (over: Partial<FlowArgs>) => args({ setup: setupOf(guided), studio: used(), ...over });

  it('saves without drawing, says so, and asks before spending anything', () => {
    const T = turnsFor(flow({ set: offered() }));
    expect(keys(T).slice(-3)).toEqual(['you:use', 'scenri:saved', 'q:set-start']);
    expect(T.find((x) => x.kind === 'scenri' && x.id === 'saved')).toMatchObject({
      text: 'Saved. Nothing is drawn until you ask.',
    });
    // nothing drawn, nothing drawing: the offer is the only thing that spends
    expect(keys(T).some((k) => k.includes(':ex-'))).toBe(false);
    const q = lastQ(T);
    expect(q?.prompt).toBe('Show it in use? Two pictures with a Scenri demo product in the place: hero and close-up.');
    expect(q?.kind === 'confirm' && q.options.map((o) => [o.id, o.label])).toEqual([
      ['draw-set', 'Draw them'],
      ['not-now', 'Not now'],
    ]);
    // a world built around a person is offered the same two, said of a presenter
    expect(lastQ(turnsFor(flow({ set: offered({ who: 'presenter' }) })))?.prompt).toContain('a Scenri demo presenter');
  });

  it('offers the set again, counted, when the place moved under it', () => {
    const moved = offered({ tiles: [tile('hero', 'shown', 'b')] as any, stale: true });
    const T = turnsFor(flow({ set: moved }));
    const q = lastQ(T);
    expect(q?.id).toBe('set-start');
    expect(q?.prompt).toBe('Two pictures here show the place as it was before. Draw them again?');
    expect(q?.kind === 'confirm' && q.options.map((o) => o.label)).toEqual(['Draw them again', 'Not now']);
    // what was pressed stands in the transcript, the way every other answer does
    expect(keys(turnsFor(flow({ studio: drew(), set: moved })))).toContain('you:set-start');
  });

  it('goes straight to the last press when the offer is declined, and says where it can still be drawn', () => {
    const declined = reduce(used(), { type: 'set-declined' });
    const T = turnsFor(flow({ studio: declined, set: offered() }));
    expect(T.find((x) => x.kind === 'you' && x.id === 'set-start')).toMatchObject({ text: 'Not now' });
    const q = lastQ(T);
    expect(q).toMatchObject({
      id: 'set-done',
      prompt: 'Tide Shelf is ready. It can be shown in use any time, from its page.',
    });
    expect(q?.kind === 'confirm' && q.options.map((o) => [o.id, o.label])).toEqual([['done', 'Open scene']]);
  });

  it('never offers to draw where nothing can be drawn', () => {
    // no engine that can draw: saving still ends, and asks for nothing
    expect(lastQ(turnsFor(flow({ set: offered(), canDraw: false })))?.id).toBe('set-done');
    // the run has not been read yet: what is drawing is not known, so nothing is offered
    expect(lastQ(turnsFor(flow({ set: offered({ read: false }) })))).toBeNull();
  });

  it('says it is saved and shows the pictures as they come, asking nothing while they draw', () => {
    const drawing = set({ running: true, tiles: [tile('hero', 'drawing'), tile('close', 'drawing')] as any });
    const T = turnsFor(flow({ studio: drew(), set: drawing }));
    expect(keys(T).slice(-3)).toEqual(['you:use', 'scenri:saved', 'you:set-start']);
    expect(T.find((x) => x.kind === 'scenri' && x.id === 'saved')).toMatchObject({
      text: expect.stringContaining('Saved. Now it is shown in use, with a Scenri demo product'),
    });
    expect(lastQ(T)).toBeNull();
    // the place is decided: no Put back on it, no pencil on the answers, nothing to type
    expect(T.some((t) => t.kind === 'scenri' && !!t.restore)).toBe(false);
    expect(T.some((t) => t.kind === 'you' && t.editable)).toBe(false);
    expect(composerFor(flow({ studio: drew(), set: drawing }), null).target.kind).toBe('off');
  });

  it('lands each picture with Try again, then offers three more or Not now', () => {
    const landed = set({ tiles: [tile('hero', 'shown', 'b'), tile('close', 'shown', 'c')] as any });
    const T = turnsFor(flow({ studio: drew(), set: landed }));
    expect(keys(T).slice(-3)).toEqual([`scenri:ex-hero-${H('b')}`, `scenri:ex-close-${H('c')}`, 'q:set-more']);
    expect(T.find((t) => t.kind === 'scenri' && t.id === `ex-hero-${H('b')}`)).toMatchObject({
      text: 'Here is the hero.',
      thumb: H('b'),
      label: 'Hero',
      retry: 'hero',
    });
    const q = lastQ(T);
    expect(q?.prompt).toBe('Add three more? Hands, another angle and a bold one.');
    expect(q?.kind === 'confirm' && q.options.map((o) => o.label)).toEqual(['Add them', 'Not now']);
    // two, for a place built around a person
    const two = lastQ(turnsFor(flow({ studio: drew(), set: { ...landed, missing: ['angle', 'bold'] } })));
    expect(two?.prompt).toBe('Add two more? Another angle and a bold one.');
  });

  it('ends on the last press once nothing more is wanted', () => {
    const landed = set({ tiles: [tile('hero', 'shown', 'b'), tile('close', 'shown', 'c')] as any });
    const declined = reduce(drew(), { type: 'decline-more' });
    const q = lastQ(turnsFor(flow({ studio: declined, set: landed })));
    expect(q).toMatchObject({ id: 'set-done', prompt: 'Tide Shelf is ready.' });
    expect(q?.kind === 'confirm' && q.options.map((o) => [o.id, o.label])).toEqual([['done', 'Open scene']]);
    // all three drawn: nothing more to offer
    const full = lastQ(turnsFor(flow({ studio: drew(), set: { ...landed, missing: [] } })));
    expect(full?.id).toBe('set-done');
    // opened from Create, the last press goes back to the shot
    expect(lastQ(turnsFor(flow({ studio: declined, set: { ...landed, finish: 'Use in a shot' } })))).toMatchObject({
      options: [{ id: 'done', label: 'Use in a shot' }],
    });
  });

  it('says which did not draw, and offers them again before the last press', () => {
    const broken = set({ tiles: [tile('hero', 'shown', 'b'), tile('close', 'failed')] as any, missing: [] });
    const T = turnsFor(flow({ studio: drew(), set: broken }));
    expect(T.find((t) => t.kind === 'scenri' && t.id === 'ex-failed-close')).toMatchObject({
      text: 'The close-up did not draw: the engine returned no picture.',
      tone: 'alert',
    });
    const q = lastQ(T);
    expect(q?.prompt).toBe('Tide Shelf is ready. Some did not draw.');
    expect(q?.kind === 'confirm' && q.options.map((o) => o.id)).toEqual(['retry-failed', 'done']);
    // a failed hero has nothing to add more to
    const noHero = lastQ(turnsFor(flow({ studio: drew(), set: set({ tiles: [tile('hero', 'failed')] as any }) })));
    expect(noHero?.id).toBe('set-done');
  });

  it("says so when Scenri's library cannot stand in the place yet, and still ends", () => {
    const T = turnsFor(flow({ studio: drew(), set: set({ noSubject: true, missing: [] }) }));
    expect(T.find((t) => t.kind === 'scenri' && t.id === 'saved')).toMatchObject({
      text: "Saved. Scenri's library has not downloaded yet, so it cannot be shown in use for now.",
    });
    expect(lastQ(T)?.id).toBe('set-done');
  });

  it('is no longer a draft, nor unsaved, and comes back after a reload still saved', () => {
    const s = reduce(drew(), { type: 'decline-more' });
    expect(keptAsDraft(s)).toBe(false);
    expect(unsaved(s, null)).toBe(false);
    const back = unpackSession(packSession(setupOf(guided), s));
    expect(back?.studio).toMatchObject({ saved: 'us-1', moreDeclined: true, setDrawn: true, setDeclined: false });
    // a conversation packed before the offer existed carries neither, so it is
    // offered rather than swallowed by a flag it never set
    const old = unpackSession(packSession(setupOf(guided), reduce(used(), { type: 'set-declined' })));
    expect(old?.studio).toMatchObject({ setDrawn: false, setDeclined: true });
  });
});
