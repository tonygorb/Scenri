import { describe, expect, it } from 'vitest';
import { type Aside, type NothingKind, answersNothing } from '../src/conversation/question.ts';
import {
  type Action,
  type CreationState,
  EMPTY_STATE,
  NO_DRAFT,
  deserialize,
  reduce,
  serialize,
} from '../src/create/presenter/creationState.ts';
import {
  activeQuestion,
  asidePhaseFor,
  compileDirection,
  compileKeep,
  compileRefs,
  composerFor,
  flowContext,
  notAnAnswerAtAStep,
  sentenceTarget,
  turnsFor,
} from '../src/create/presenter/presenterFlowRules.ts';
import {
  type Qid,
  SPECS,
  answeredIn,
  isQid,
  nextQuestion,
  unsound,
} from '../src/create/presenter/presenterQuestions.ts';
import { type StepDraft, nextStep } from '../src/create/presenter/presenterSteps.ts';
import { type DraftLike, emptySlot, readsAsPerson } from '../src/create/presenter/presenterStudioRules.ts';
import { TRAITS, type TraitId, traitOf } from '../src/create/presenter/presenterTraits.ts';

/**
 * The flow, walked at random, checked after every step.
 *
 * Everything else in this suite asserts a case somebody thought of. This walks
 * the reducer through sequences nobody would think of, with a fixed seed so a
 * failure is reproducible, and asserts the things that must be true after any
 * action whatsoever. Every bug found by hand in this area has been a violation
 * of one of these, discovered late: an answer to a question that no longer
 * exists, a sentence standing under a question it never answered, a compile
 * that throws on a shape the reducer allowed in.
 */

/** mulberry32: the same walk every run, and a seed to reproduce a failure with. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What a person can type, including everything they should not. */
const SENTENCES = [
  'a woman in her 40s, short silver hair, slim, warm',
  'pony tail',
  'kare',
  'hi',
  'Hair',
  'lol3',
  'zzz999',
  'what can you do?',
  'go back',
  'make her look like Zendaya',
  '   ',
  '90s',
  'olive',
  'a chin-length bob',
  '😀',
  'شعر قصير',
  'x'.repeat(400),
  'Maren',
];

const VALUES: Partial<Record<string, unknown[]>> = {
  source: [
    { door: 'scratch', via: 'taps' },
    { door: 'photos', via: 'taps' },
    { door: 'scratch', via: 'typed' },
  ],
  photos: [
    { hashes: ['h1'], attested: true },
    { hashes: ['h1', 'h2'], attested: false },
  ],
  describe: ['a tall woman in her 30s with dark hair', 'someone'],
  gaps: [{ who: 'woman' }, 'skipped'],
  traits: [[], ['glasses'], ['glasses', 'tattoo'], TRAITS.slice(0, 3).map((t) => t.id)],
  keep: [
    { words: 'a scar', refs: [] },
    { words: 'a ring', refs: ['h9'] },
  ],
};

const valueFor = (id: Qid, r: () => number): unknown => {
  const known = VALUES[id];
  if (known) return known[Math.floor(r() * known.length)];
  const said = SENTENCES[Math.floor(r() * SENTENCES.length)];
  // A question with options holds two halves: what was tapped and the words
  // about it. The walk gives it both, one time in three, so the codec and the
  // compile are exercised on a qualified answer as well as a bare one.
  const both = r() < 0.34;
  if (id.endsWith('-where')) return both ? { pick: 'on the left forearm', words: said } : { words: said };
  if (id.startsWith('trait-')) {
    const t = traitOf(id.slice('trait-'.length) as TraitId);
    return both && t ? { pick: t.options[0].id, words: said, refs: [] } : { words: said, refs: [] };
  }
  if (id.startsWith('look-')) return both ? { pick: 'either', words: said } : { words: said };
  return said;
};

/**
 * The clock never goes backwards, and sometimes does not move at all.
 *
 * `nowIso` has millisecond resolution, so two sentences said in the same
 * millisecond carry the same `at` honestly. One in four does here, because that
 * is the case that gave two turns one key and let React animate the wrong line.
 */
let tick = 0;
const at = (r: () => number) => {
  if (r() >= 0.25) tick += 1;
  return String(tick).padStart(12, '0');
};
const aside = (q: string | null, r: () => number): Aside => {
  const said = SENTENCES[Math.floor(r() * SENTENCES.length)];
  const kind = (answersNothing(said, readsAsPerson) ?? 'vague') as NothingKind;
  return { said, reply: 'Say more.', q, at: at(r), kind };
};

/** One random action against the state as it stands. */
function nextAction(s: CreationState, r: () => number): Action {
  const ctx = NO_DRAFT;
  const open = nextQuestion(s.answers, ctx);
  const answered = answeredIn(s.answers, ctx);
  const roll = r();
  if (roll < 0.34 && open) return { type: 'answer', patch: { [open]: valueFor(open, r) }, ctx };
  if (roll < 0.46 && answered.length) {
    const id = answered[Math.floor(r() * answered.length)];
    return { type: 'answer', patch: { [id]: valueFor(id, r) }, ctx };
  }
  if (roll < 0.58) return { type: 'aside', aside: aside(open, r) };
  if (roll < 0.66 && s.asides.length) {
    const a = s.asides[Math.floor(r() * s.asides.length)];
    return { type: 'amend-aside', at: a.at, said: SENTENCES[0], reply: 'Say more.', kind: 'vague', ctx };
  }
  if (roll < 0.7 && s.asides.length) {
    return { type: 'drop-aside', at: s.asides[Math.floor(r() * s.asides.length)].at };
  }
  if (roll < 0.76 && answered.length) {
    return { type: 'edit', id: answered[Math.floor(r() * answered.length)] };
  }
  if (roll < 0.8) return { type: 'cancel-edit' };
  if (roll < 0.84) return { type: 'say', id: open ?? null };
  if (roll < 0.88) return { type: 'text', text: SENTENCES[Math.floor(r() * SENTENCES.length)] };
  if (roll < 0.9) return { type: 'colour', hex: '#7F3FBF', step: open ?? null };
  if (roll < 0.92) return { type: 'colour', hex: null, step: open ?? null };
  if (roll < 0.94) return { type: 'uploaded', hash: `h${Math.floor(r() * 5)}`, max: 4 };
  if (roll < 0.95) return { type: 'remove-photo', hash: 'h1' };
  if (roll < 0.96) return { type: 'extras-declined' };
  if (roll < 0.97) return { type: 'attest', checked: r() < 0.5 };
  if (roll < 0.98) return { type: 'settle-unsure', ctx };
  if (roll < 0.99) return { type: 'unsure', unsure: { said: SENTENCES[0], q: open ?? null, at: at(r) }, ctx };
  return { type: 'start-over' };
}

const slot = (over: Record<string, unknown> = {}) => ({ ...emptySlot(), ...over });
const approved = (hash: string) => slot({ status: 'approved', hash });

const drawn = (over: Partial<DraftLike> = {}): DraftLike => ({
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

/**
 * Every shape a draft can be in while somebody is looking at it. The drawn half
 * is where most of what has gone wrong here went wrong, and none of it is
 * reachable by driving the reducer alone.
 */
const DRAFTS: (DraftLike | null)[] = [
  null,
  drawn({
    stage: 'drawing',
    activeView: 'portrait',
    views: { ...drawn().views, portrait: slot({ status: 'generating' }) },
  }),
  drawn({ views: { ...drawn().views, portrait: slot({ status: 'candidate', hash: 'p1' }) } }),
  drawn({ views: { ...drawn().views, portrait: approved('p1'), front: slot({ status: 'candidate', hash: 'f1' }) } }),
  drawn({
    views: {
      ...drawn().views,
      portrait: approved('p1'),
      front: slot({ status: 'candidate', hash: 'f2', prior: 'f1' }),
    },
  }),
  drawn({
    name: 'Maren',
    views: { ...drawn().views, portrait: approved('p1'), front: approved('f1'), 'three-quarter': approved('t1') },
  }),
  drawn({
    views: {
      ...drawn().views,
      portrait: approved('p1'),
      front: slot({ status: 'approved', hash: 'f1', error: 'the engine fell over' }),
    },
  }),
  drawn({
    extras: true,
    name: 'Noor',
    views: {
      portrait: approved('p1'),
      front: approved('f1'),
      'three-quarter': approved('t1'),
      back: approved('b1'),
      left: approved('l1'),
      right: approved('r1'),
    },
  }),
  drawn({
    source: 'photos',
    sources: ['h1'],
    views: { ...drawn().views, portrait: slot({ status: 'approved', hash: 'h1', origin: 'photo' }) },
  }),
  drawn({ stage: 'analyzing', source: 'photos', sources: ['h1'] }),
];

/** Everything that must be true of the flow, whatever was just done to it. */
function check(s: CreationState, step: number, seed: number, action: Action) {
  const where = `seed ${seed}, step ${step}, after ${action.type}`;
  const ctx = flowContext(null, true);

  // 1. Every answer belongs to a question that exists right now.
  expect(unsound(s.answers, ctx), `${where}: unsound answers`).toEqual([]);

  // 2. The answers list is the table's order, and holds no duplicates.
  const listed = answeredIn(s.answers, ctx);
  expect(new Set(listed).size, `${where}: duplicate answers`).toBe(listed.length);
  const order = SPECS.map((x) => x.id);
  expect(
    [...listed].sort((x, y) => order.indexOf(x) - order.indexOf(y)),
    `${where}: answer order`,
  ).toEqual(listed);

  // 3. Nothing said in passing stands at a question that no longer exists, and
  //    none of it sits after the question the conversation is on.
  const open = nextQuestion(s.answers, ctx);
  for (const a of s.asides) {
    if (!a.q || !isQid(a.q)) continue;
    expect(listed.includes(a.q) || a.q === open, `${where}: aside at ${a.q} with no question`).toBe(true);
  }

  // 4. What is being changed is something that can be changed.
  if (s.editing && s.editing !== 'name' && !String(s.editing).startsWith('aside:')) {
    expect(listed.includes(s.editing as Qid), `${where}: editing ${s.editing}`).toBe(true);
  }

  // 5. The transcript is a pure function of the state and never throws, in
  //    front of any draft, and every turn it yields has an id of its own.
  // Twenty transcripts per step is more than the walk needs to cover them, so
  // the sweep rides every seventh step: across six hundred runs every draft
  // shape still meets thousands of different states.
  for (const [i, d] of step % 7 === 0 ? DRAFTS.entries() : [].entries()) {
    for (const canGenerate of [true, false]) {
      const t = turnsFor({ state: s, draft: d, canGenerate, failed: i === 6 ? 'the engine fell over' : null });
      const ks = t.map((x) => (x.kind === 'question' ? `q:${x.question.id}` : `${x.kind}:${x.id}`));
      const dup = ks.filter((k, n) => ks.indexOf(k) !== n);
      expect(dup, `${where}: draft ${i}, generate ${canGenerate}: duplicate turn keys ${dup.join(', ')}`).toEqual([]);
      const question = activeQuestion(t);
      const c = composerFor(question, s, d, 'portrait');
      expect(c.placeholder.length, `${where}: draft ${i}: empty placeholder`).toBeGreaterThan(0);
      // nothing is refined before a face has been drawn
      if (!d?.views.portrait.hash) {
        expect(
          asidePhaseFor(sentenceTarget(s, question), question?.id ?? null, false),
          `${where}: draft ${i}`,
        ).not.toBe('refine');
      }
    }
  }
  // 9. The flow is never silently stuck. A draft that stands idle with a view
  //    still to draw, answers whole, nothing in flight, must produce a step:
  //    a seed, a sync or a draw, never nothing. The one state this rules out
  //    is the one a person sat in this morning: draft made, direction on it,
  //    nothing drawing, nothing said.
  for (const [i, d] of step % 7 === 0 ? DRAFTS.entries() : [].entries()) {
    if (d?.stage !== 'idle' || d.activeView) continue;
    const sd: StepDraft = { ...d, id: `pd-${i}`, generations: 0, detailRefs: {} };
    for (const seeded of [null, sd.id]) {
      const stepOut = nextStep({
        state: s,
        draft: sd,
        ctx,
        canDraw: true,
        busy: false,
        err: false,
        booting: false,
        draftId: sd.id,
        seededFor: seeded,
        done: new Set<string>(),
      });
      const ready = nextQuestion(s.answers, ctx) === null && !s.editing && !s.saying;
      const toDraw = Object.values(sd.views).some((v) => v.status === 'empty' || v.status === 'stale');
      const candidate = Object.values(sd.views).some((v) => v.status === 'candidate');
      if (ready && toDraw && !candidate) {
        expect(
          stepOut,
          `${where}: draft ${i} seeded=${!!seeded}: idle draft with a view to draw yielded nothing`,
        ).not.toBeNull();
      }
      // and it never draws over a question, an edit, or a view waiting on a person
      if (!ready || candidate) expect(stepOut?.kind, `${where}: draft ${i}`).not.toBe('draw');
      if (s.editing || s.saying) expect(stepOut?.kind, `${where}: draft ${i}`).not.toBe('start');
    }
  }
  const turns = turnsFor({ state: s, draft: null, canGenerate: true });

  // 6. Everything compiled off the answers survives the shapes the reducer
  //    allows. This is the check that would have caught the last word being
  //    written back as a bare string.
  expect(() => compileDirection(s.answers), `${where}: direction`).not.toThrow();
  expect(() => compileKeep(s.answers), `${where}: keep`).not.toThrow();
  expect(() => compileRefs(s.answers), `${where}: refs`).not.toThrow();
  for (const [id, refs] of Object.entries(compileRefs(s.answers))) {
    expect(Array.isArray(refs), `${where}: refs for ${id}`).toBe(true);
  }

  // 7. The composer always knows what it is for, and never offers to refine
  //    something that has not been drawn.
  const q = activeQuestion(turns);
  const composer = composerFor(q, s, null, 'portrait');
  expect(typeof composer.placeholder, `${where}: placeholder`).toBe('string');
  expect(composer.placeholder.length, `${where}: empty placeholder`).toBeGreaterThan(0);
  expect(asidePhaseFor(sentenceTarget(s, q), q?.id ?? null, false), `${where}: voice`).not.toBe('refine');

  // 8. What a reload gets back is a state the rest of this agrees with.
  const back = deserialize(serialize(s));
  expect(back, `${where}: codec`).not.toBeNull();
  if (back) {
    expect(unsound(back.answers, ctx), `${where}: codec unsound`).toEqual([]);
    // what a reload gets back is what was there, to the field
    expect(back.answers, `${where}: codec answers`).toEqual(s.answers);
    expect(back.asides, `${where}: codec asides`).toEqual(s.asides);
    // and the state it rebuilds asks the same question as the one it left
    const again = reduce(EMPTY_STATE, { type: 'restore', ...back });
    expect(nextQuestion(again.answers, ctx), `${where}: codec question`).toBe(open);
  }
}

describe('the flow, walked at random', () => {
  it('holds every invariant through six hundred runs of sixty actions', { timeout: 120_000 }, () => {
    for (let seed = 1; seed <= 600; seed++) {
      const r = rng(seed);
      let s = EMPTY_STATE;
      for (let step = 0; step < 60; step++) {
        const action = nextAction(s, r);
        const out = reduce(s, action);
        expect(out, `seed ${seed}, step ${step}: ${action.type} returned no state`).toBeDefined();
        s = out;
        check(s, step, seed, action);
      }
    }
  });

  it('a sentence is judged the same way wherever it is said', () => {
    // the classifier is a pure function of its words, so the same words at the
    // same kind of question can never come out two ways
    for (const said of SENTENCES) {
      const first = notAnAnswerAtAStep(said, readsAsPerson);
      for (let i = 0; i < 5; i++) expect(notAnAnswerAtAStep(said, readsAsPerson), said).toBe(first);
    }
  });
});
