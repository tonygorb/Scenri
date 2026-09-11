import { describe, expect, it } from 'vitest';
import type { Question, Turn } from '../src/conversation/question.ts';
import { type CreationState, EMPTY_STATE, NO_DRAFT, reduce } from '../src/create/presenter/creationState.ts';
import {
  PROMPT,
  activeQuestion,
  answerPatch,
  attachedWords,
  compileDirection,
  compileKeep,
  compileRefs,
  composerFor,
  editCost,
  flowContext,
  answeredInWords,
  asidePhaseFor,
  judgeAnswer,
  notAnAnswerAtAStep,
  sentenceTarget,
  turnsFor,
} from '../src/create/presenter/presenterFlowRules.ts';
import { HAIR_LENGTHS } from '../src/create/presenter/presenterLook.ts';
import { TRAITS } from '../src/create/presenter/presenterTraits.ts';
import { type AsidePhase, asideReply } from '../src/create/presenter/presenterCopy.ts';
import { type NothingKind, answersNothing } from '../src/conversation/question.ts';
import type { Answers, Qid } from '../src/create/presenter/presenterQuestions.ts';
import { type DraftLike, emptySlot, readsAsPerson } from '../src/create/presenter/presenterStudioRules.ts';

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
      // a tap question does not own the answer: the composer stays live and
      // asks the same step in words, for the person none of the chips is
      const c = composerFor(open(T), state(a), null, 'portrait');
      expect(c.off).toBeUndefined();
      expect(c.action).toBe('Send');
    }
    a = { ...a, 'look-build': 'lean' };
    // the rows done, what is always true of them is the one question that opens more
    expect(keys(turns(state(a))).at(-1)).toBe('q:traits');
    const T = turns(state({ ...a, traits: [] }));
    const q = open(T);
    expect(q?.id).toBe('agree');
    // the ask is short; the whole person is set apart above it, to be read or taken
    expect(q?.kind === 'confirm' && q.prompt).toBe('Here is the presenter, in full. Ready to draw?');
    expect(q?.kind === 'confirm' && q.quote).toBe(
      'A woman in their 30s with long brown hair, olive skin, a lean build.',
    );
    // one way on, and it says what is being drawn
    expect(q?.kind === 'confirm' && q.options.map((o) => o.label)).toEqual(['Draw the presenter']);
    // and everything that is always true of them is in that last word too
    const withDetails = turns(
      state({
        ...a,
        traits: ['glasses', 'tattoo', 'prosthetic'],
        'trait-glasses': { words: 'thin black rectangular metal frames', refs: [] },
        'trait-tattoo': { words: 'a solid blackwork tattoo', refs: [] },
        'trait-tattoo-where': 'on their right forearm',
        'trait-prosthetic': { words: 'a prosthetic limb in a bright painted finish', refs: [] },
        'trait-prosthetic-where': 'in place of their right arm',
      }),
    );
    const said = open(withDetails);
    expect(said?.kind === 'confirm' && said.quote).toBe(
      'A woman in their 30s with long brown hair, olive skin, a lean build, and always thin black rectangular metal frames, a solid blackwork tattoo on their right forearm and a prosthetic limb in a bright painted finish in place of their right arm.',
    );
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
    // a picture of the thing itself rides with the answer
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

describe('a question with chips still takes words', () => {
  const at = (a: Answers) => {
    const T = turns(state(a));
    const q = open(T);
    return { q, c: composerFor(q, state(a), null, 'portrait') };
  };

  it('a look step asks itself in words, and a typed sentence is aimed at that step', () => {
    const a: Answers = { source: { door: 'scratch', via: 'taps' }, 'look-who': 'woman' };
    const { q, c } = at(a);
    expect(q?.id).toBe('look-age');
    expect(c.off).toBeUndefined();
    expect(sentenceTarget(state(a), q)).toBe('look-age');
  });

  it('a colour step carries the colour control without being handed over first', () => {
    const a: Answers = { source: { door: 'scratch', via: 'taps' }, 'look-who': 'woman', 'look-age': '30s' };
    const { q, c } = at(a);
    expect(q?.id).toBe('look-hair');
    expect(c.color).toBe(true);
    expect(c.off).toBeUndefined();
  });

  it('a detail asks what it looks like, and the sentence goes to that detail', () => {
    const a: Answers = { ...TAPPED, traits: ['glasses'] };
    const { q, c } = at(a);
    expect(q?.id).toBe('trait-glasses');
    expect(c.off).toBeUndefined();
    expect(sentenceTarget(state(a), q)).toBe('trait-glasses');
  });

  it('the chooser of details takes a detail in words, and the gaps question takes the words it was missing', () => {
    const chooser = at({ ...TAPPED });
    expect(chooser.q?.id).toBe('traits');
    expect(chooser.c.off).toBeUndefined();
    const gaps = at({ source: { door: 'scratch', via: 'typed' }, describe: 'tall' });
    expect(gaps.q?.id).toBe('gaps');
    expect(gaps.c.off).toBeUndefined();
  });

  it('what a person types instead of tapping is answered as that step, not as noise', () => {
    // the step's own ask is what comes back, so small talk at the hair row is
    // answered by the hair row rather than by a general apology
    expect(answersNothing('hi', readsAsPerson)).toBe('greeting');
    expect(answersNothing('what can you do?', readsAsPerson)).toBe('question');
    expect(answersNothing('auburn, past the shoulder', readsAsPerson)).toBeNull();
    const reply = asideReply('greeting', 'look', 0, 'hi', 'colour');
    expect(reply.length).toBeGreaterThan(0);
    expect(reply).not.toMatch(/nothing to type/i);
  });

  it('a short answer to a short question is an answer, not noise', () => {
    // Every one of these was refused at "And the length?" and sent the same
    // sentence back five times. They describe nobody, which is the general
    // test, and they answer the question, which is the only test that matters
    // at a step.
    for (const said of ['pony tail', 'kare', 'CARE', 'buzz cut', 'not fat', 'extra fat']) {
      expect(notAnAnswerAtAStep(said, readsAsPerson), said).toBeNull();
    }
    // the general test is what refused them, and it still says what it said
    expect(answersNothing('pony tail', readsAsPerson)).toBe('vague');
    expect(answersNothing('kare', readsAsPerson)).toBe('vague');
    // and what is plainly conversation still is, at a step as anywhere else
    for (const said of ['hi', 'what can you do?', 'go back']) {
      expect(notAnAnswerAtAStep(said, readsAsPerson), said).not.toBeNull();
    }
    // so is a mash at the keyboard, digits in it or not: the letters are read
    // alone, so "zzz999" is the same thing as "zzz"
    for (const said of ['zzz', 'zzz999', 'asdfgh', 'qqqqq']) {
      expect(notAnAnswerAtAStep(said, readsAsPerson), said).toBe('nonsense');
    }
    // and a short answer with vowels in it is still an answer
    for (const said of ['bob', 'a bob', 'kare', 'pony tail']) {
      expect(notAnAnswerAtAStep(said, readsAsPerson), said).toBeNull();
    }
    // naming the subject is not answering the question. "Hair" at "And the
    // length?" was taken as the cut, because a bare capitalised word is
    // allowed to be a name and a short phrase is allowed to be an answer.
    for (const said of ['Hair', 'hair', 'the hair', 'Length', 'skin', 'Build', 'colour', 'tattoo']) {
      expect(notAnAnswerAtAStep(said, readsAsPerson), said).toBe('nonsense');
    }
    // a real answer that merely contains one of those words is untouched
    for (const said of ['dark hair', 'hair to the shoulder', 'olive skin']) {
      expect(notAnAnswerAtAStep(said, readsAsPerson), said).toBeNull();
    }
    // a word with a number stuck on it is somebody seeing what happens
    for (const said of ['lol3', 'lol34', 'test1', 'zzz999']) {
      expect(notAnAnswerAtAStep(said, readsAsPerson), said).toBe('nonsense');
    }
    // and the words people type when they are not answering are not answers,
    // whichever kind they land under
    for (const said of ['lol', 'haha', 'idk', 'meh', 'nvm']) {
      expect(notAnAnswerAtAStep(said, readsAsPerson), said).not.toBeNull();
    }
    // a number in front is a real answer, and is left alone
    for (const said of ['90s', '50s bob', 'a 40s wave']) {
      expect(notAnAnswerAtAStep(said, readsAsPerson), said).toBeNull();
    }
  });

  it('the same reply is not sent a third time; the way out is named instead', () => {
    const first = asideReply('greeting', 'look', 0, 'hi', 'length');
    const second = asideReply('greeting', 'look', 1, 'hi', 'length');
    const third = asideReply('greeting', 'look', 2, 'hi', 'length');
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
    expect(third).toMatch(/Skip/);
  });
});

describe('every question answers a stray sentence in its own voice', () => {
  // The bug this pins: a look step replied "say what should change: hair, age
  // or build change the person", which is the voice of a presenter already
  // drawn, to somebody four questions away from a picture. The voice is a
  // function of what the sentence was aimed at, so every question is checked.
  const voices: [string, Qid | 'keep' | null, string | null, AsidePhase][] = [
    ['the door', 'source', 'source', 'source'],
    ['a description', 'describe', 'describe', 'describe'],
    ['the gaps in one', null, 'gaps', 'describe'],
    ['who they are', 'look-who', 'look-who', 'look'],
    ['their age', 'look-age', 'look-age', 'look'],
    ['their hair', 'look-hair', 'look-hair', 'look'],
    ['its length', 'look-length', 'look-length', 'look'],
    ['their skin', 'look-skin', 'look-skin', 'look'],
    ['their build', 'look-build', 'look-build', 'look'],
    ['the chooser of details', null, 'traits', 'detail'],
    ['a detail', 'trait-glasses', 'trait-glasses', 'detail'],
    ['where it is', 'trait-tattoo-where', 'trait-tattoo-where', 'detail'],
    ['the last word', 'keep', 'agree', 'detail'],
    ['their name', null, 'name', 'name'],
  ];

  it.each(voices)('%s is answered in its own voice, before a picture and after', (_n, target, open, want) => {
    expect(asidePhaseFor(target, open, false)).toBe(want);
    expect(asidePhaseFor(target, open, true)).toBe(want);
  });

  it('nothing speaks in the refine voice until there is something to refine', () => {
    // every id the flow knows, plus ones it does not
    const ids = [...voices.map((v) => v[2]), 'blind', 'retry', 'photos', 'noengine', 'agree', 'unsure', null, 'x'];
    for (const id of ids) expect(asidePhaseFor(null, id, false), String(id)).not.toBe('refine');
    // and once a face stands, an id that belongs to no question is a refinement
    expect(asidePhaseFor(null, null, true)).toBe('refine');
    expect(asidePhaseFor(null, 'retry', true)).toBe('refine');
  });

  it('every voice has words for every way a sentence can answer nothing', () => {
    const kinds: NothingKind[] = [
      'likeness',
      'help',
      'question',
      'greeting',
      'ack',
      'nav',
      'intent',
      'go',
      'nonsense',
      'vague',
    ];
    const phases: AsidePhase[] = ['source', 'describe', 'name', 'look', 'detail', 'refine'];
    for (const phase of phases) {
      for (const kind of kinds) {
        for (const again of [0, 1, 2]) {
          const said = asideReply(kind, phase, again, 'whatever', phase === 'look' ? 'length' : undefined);
          expect(said, `${phase}/${kind}/${again}`).toBeTruthy();
          expect(said, `${phase}/${kind}/${again}`).not.toMatch(/undefined|\[object/i);
          // a setup voice never borrows the words of a drawn presenter
          if (phase !== 'refine') expect(said, `${phase}/${kind}`).not.toMatch(/view on the stage/i);
        }
      }
    }
  });
});

describe('an answer is judged the same whichever way it arrives', () => {
  // Tony's case: "Lungo123" typed at the length is refused, and the very same
  // words written over the answer used to be accepted, because only the send
  // path asked. Both doors ask now, and they ask the same thing.
  const cases: [Qid, string, boolean][] = [
    ['look-length', 'Lungo123', false],
    ['look-length', 'a chin-length bob', true],
    ['look-length', 'pony tail', true],
    ['look-length', 'Hair', false],
    ['look-length', 'hi', false],
    ['look-hair', 'zzz999', false],
    ['look-hair', 'auburn', true],
    ['trait-glasses', 'test1', false],
    ['trait-glasses', 'wire aviators', true],
    ['keep', 'lol3', false],
    ['keep', 'a chipped front tooth', true],
    ['describe', 'hi', false],
    ['describe', 'a tall woman in her 30s with dark hair', true],
  ];

  it.each(cases)('%s: %s', (id, said, answers) => {
    const verdict = judgeAnswer(id, said, readsAsPerson);
    expect(verdict === null, `${id} / ${said}`).toBe(answers);
  });

  it('nothing at all is never an answer, whatever is being asked', () => {
    for (const id of ['look-who', 'look-build', 'trait-glasses', 'keep', 'describe'] as Qid[]) {
      expect(judgeAnswer(id, '   ', readsAsPerson), id).not.toBeNull();
    }
  });
});

describe('changing an answer that was typed', () => {
  it('is rewritten where it stands, and one that was tapped reopens its row', () => {
    const typed: Answers = { 'look-length': 'a pony tail' };
    const tapped: Answers = { 'look-length': HAIR_LENGTHS[0].id };
    expect(answeredInWords('look-length', typed)).toBe(true);
    expect(answeredInWords('look-length', tapped)).toBe(false);
    // the free-text questions are always rewritten, whatever they hold
    expect(answeredInWords('describe', { describe: 'a tall woman' })).toBe(true);
    expect(answeredInWords('keep', { keep: { words: 'a scar', refs: [] } })).toBe(true);
  });

  it('the last word is written back in its own shape, pictures and all', () => {
    // It is shaped like a detail, so rewriting it as a bare string handed
    // everything that reads its pictures an answer with no pictures on it,
    // and compiling them threw on the spot.
    const a: Answers = { ...TAPPED, keep: { words: 'a chipped tooth', refs: ['h1'] } };
    expect(answeredInWords('keep', a)).toBe(true);
    expect(compileRefs(a)).toEqual({ keep: ['h1'] });
    // and an answer with no pictures compiles to nothing rather than throwing
    expect(compileRefs({ ...TAPPED, keep: { words: 'a chipped tooth', refs: [] } })).toEqual({});
    expect(compileRefs({ ...TAPPED })).toEqual({});
  });

  it('holds for a detail too, and a detail said in words keeps its pictures', () => {
    const t = TRAITS[0];
    expect(answeredInWords(`trait-${t.id}`, { [`trait-${t.id}`]: { words: t.options[0].id, refs: [] } })).toBe(false);
    expect(answeredInWords(`trait-${t.id}`, { [`trait-${t.id}`]: { words: 'wire aviators', refs: ['h1'] } })).toBe(
      true,
    );
  });

  it('the answer standing in the transcript is the one being rewritten', () => {
    const a: Answers = { ...TAPPED, 'look-length': 'a pony tail' };
    const T = turns(state(a, { editing: 'look-length' }));
    const you = T.find((t) => t.kind === 'you' && t.id === 'look-length');
    expect(you?.kind === 'you' && you.editing).toBe(true);
    // and a tapped one reopens as its row instead
    const T2 = turns(state({ ...TAPPED }, { editing: 'look-length' }));
    expect(T2.some((t) => t.kind === 'question' && t.question.id === 'look-length')).toBe(true);
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

  it('the full body is the second decision, and a first landing has no previous to keep', () => {
    const d = draft({
      views: {
        ...draft().views,
        portrait: approved('p1'),
        front: { ...emptySlot(), status: 'candidate', hash: 'f1' },
      },
    });
    const q = open(turns(state(a), d));
    expect(q?.id).toBe('view-revision');
    expect(q?.prompt).toBe('Here is the full body. Use it, or try again.');
    // nothing stood here before it, so there is nothing to go back to
    expect(q?.kind === 'confirm' && q.options.map((o) => o.id)).toEqual(['use', 'again']);
  });

  it('a redrawn view is a revision, and that one does offer the previous picture', () => {
    const d = draft({
      views: {
        ...draft().views,
        portrait: approved('p1'),
        front: { ...emptySlot(), status: 'candidate', hash: 'f2', prior: 'f1' },
      },
    });
    const q = open(turns(state(a), d));
    expect(q?.id).toBe('view-revision');
    expect(q?.prompt).toBe('Redrew the full body. Use it, or keep the previous one.');
    expect(q?.kind === 'confirm' && q.options.map((o) => o.id)).toEqual(['use', 'keep', 'again']);
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

describe('a picture of the thing itself', () => {
  it('is an answer of its own, in words that say exactly that', () => {
    expect(attachedWords('glasses', 1)).toBe('the glasses in the attached picture');
    expect(attachedWords('tattoo', 2)).toBe('the tattoo in the attached pictures');
    expect(attachedWords('prosthetic', 1)).toBe('the prosthetic limb in the attached picture');
  });

  it('rides with the answer rather than standing in the question', () => {
    const a: Answers = {
      ...TAPPED,
      traits: ['glasses'],
      'trait-glasses': { words: 'the glasses in the attached picture', refs: ['h-frames'] },
    };
    const T = turns(state(a));
    const answer = T.find((t) => t.kind === 'you' && t.id === 'trait-glasses');
    expect(answer?.kind === 'you' && answer.photos).toEqual(['h-frames']);
    // the question offers the same way in as the pill beside the composer, and
    // says which of the two it is doing
    const asking = open(turns(state({ ...a, 'trait-glasses': { refs: [] } })));
    expect(asking?.kind === 'choice' && asking.attach).toBe('Add a reference');
    const again = open(turns(state({ ...a, 'trait-glasses': { refs: ['h-frames'] } })));
    expect(again?.kind === 'choice' && again.attach).toBe('Replace the reference');
  });

  it('leaves the field asking for words, not for a photograph', () => {
    const s = state({ ...TAPPED, traits: ['glasses'] }, { saying: 'trait-glasses' });
    expect(composerFor(open(turns(s)), s, null, 'portrait').placeholder).toBe('Describe the glasses');
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
      keep: { words: 'a red thread bracelet', refs: ['h-bracelet'] },
    };
    expect(compileDirection(a)).toBe('a woman in their 30s with long dyed purple hair, olive skin, a lean build');
    expect(compileKeep(a)).toBe(
      'thin black rectangular metal frames, a small geometric line tattoo on their right forearm, a red thread bracelet',
    );
    expect(compileRefs(a)).toEqual({ glasses: ['h-frames'], keep: ['h-bracelet'] });
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
    // and the read-back's line is open the whole time: it is the free hand over
    // the rows, for whatever no question thought to ask
    const r = state({ ...TAPPED, traits: [] });
    const c2 = composerFor(open(turns(r)), r, null, 'portrait');
    expect(c2.off).toBeUndefined();
    expect(c2.placeholder).toBe('A scar, a ring, anything we missed');
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
