import { describe, expect, it } from 'vitest';
import {
  type Answers,
  type FlowContext,
  NO_DRAFT,
  type Qid,
  SPECS,
  answered,
  answeredIn,
  applies,
  commit,
  descriptionGaps,
  nextQuestion,
  traitDetails,
  unsound,
} from '../src/create/presenter/presenterQuestions.ts';

/** A person tapped all the way to the read-back, with two details answered. */
const TAPPED: Answers = {
  source: { door: 'scratch', via: 'taps' },
  'look-who': 'woman',
  'look-age': '30s',
  'look-hair': 'brown',
  'look-length': 'long',
  'look-skin': 'olive',
  'look-build': 'lean',
  traits: ['glasses', 'tattoo'],
  'trait-glasses': { words: 'thin black rectangular metal frames', refs: [] },
  'trait-tattoo': { words: 'a floral tattoo in soft grey shading', refs: ['h-ink'] },
  'trait-tattoo-where': 'on their right forearm',
};

const photosDraft = (keep?: string, portrait = 'approved'): FlowContext => ({
  draft: { source: 'photos', stage: 'idle', keep, views: { portrait: { status: portrait } } },
  canGenerate: true,
});

/** What must hold after every change, whatever the change was. */
function sound(a: Answers, ctx: FlowContext = NO_DRAFT) {
  // 1 and 3: every answer belongs to a question that exists right now
  expect(unsound(a, ctx)).toEqual([]);
  // 2 and 15: one answer per id, in the table's order, each id once
  const ids = answeredIn(a, ctx);
  expect(new Set(ids).size).toBe(ids.length);
  const order = SPECS.map((s) => s.id);
  expect(ids).toEqual([...ids].sort((x, y) => order.indexOf(x) - order.indexOf(y)));
  // 4: the next question exists and has no answer
  const next = nextQuestion(a, ctx);
  if (next) {
    expect(applies(next, a, ctx)).toBe(true);
    expect(answered(next, a, ctx)).toBe(false);
  }
  // 7: a placement is never held without the detail it places, and pictures never without the trait
  for (const id of Object.keys(a) as Qid[]) {
    if (id.endsWith('-where')) expect(a[id.slice(0, -'-where'.length) as Qid]).toBeDefined();
    if (id.startsWith('trait-') && !id.endsWith('-where')) expect(a.traits).toContain(id.slice('trait-'.length));
  }
}

describe('the presenter questions, as one table', () => {
  it('answers the first question and asks the next', () => {
    const a = commit({}, { source: { door: 'scratch', via: 'taps' } }, NO_DRAFT);
    expect(nextQuestion(a, NO_DRAFT)).toBe('look-who');
    sound(a);
    const b = commit(a, { 'look-who': 'man' }, NO_DRAFT);
    expect(nextQuestion(b, NO_DRAFT)).toBe('look-age');
    sound(b);
  });

  it('edits the same answer in place', () => {
    const a = commit({}, { source: { door: 'scratch', via: 'taps' }, 'look-who': 'man' }, NO_DRAFT);
    const b = commit(a, { 'look-who': 'woman' }, NO_DRAFT);
    expect(b['look-who']).toBe('woman');
    expect(answeredIn(b, NO_DRAFT)).toEqual(['source', 'look-who']);
    sound(b);
  });

  it('edits an answer three questions back and keeps everything independent of it', () => {
    const b = commit(TAPPED, { 'look-hair': 'blonde' }, NO_DRAFT);
    expect(b['look-hair']).toBe('blonde');
    // 6: the length, skin and build were not given in the light of the colour
    expect(b['look-length']).toBe('long');
    expect(b['look-skin']).toBe('olive');
    expect(b['look-build']).toBe('lean');
    // and neither were the details
    expect(b.traits).toEqual(['glasses', 'tattoo']);
    expect(b['trait-tattoo-where']).toBe('on their right forearm');
    // nothing is left to ask: the read-back is next
    expect(nextQuestion(b, NO_DRAFT)).toBeNull();
    sound(b);
  });

  it('takes everything back when the foundation changes', () => {
    const b = commit(TAPPED, { source: { door: 'photos', via: 'taps' } }, NO_DRAFT);
    expect(Object.keys(b)).toEqual(['source']);
    expect(nextQuestion(b, NO_DRAFT)).toBe('photos');
    sound(b);
  });

  it('drops the other branch on a source change, both ways', () => {
    const p = commit(
      {},
      { source: { door: 'photos', via: 'taps' }, photos: { hashes: ['h1'], attested: true } },
      NO_DRAFT,
    );
    const s = commit(p, { source: { door: 'scratch', via: 'taps' } }, NO_DRAFT);
    expect(s.photos).toBeUndefined();
    sound(s);
    // the same door chosen again changes nothing
    expect(commit(p, { source: { door: 'photos', via: 'taps' } }, NO_DRAFT)).toEqual(p);
    // rows tapped, then described instead: the rows go, the sentence is the answer now
    const w = commit(TAPPED, { source: { door: 'scratch', via: 'words' }, describe: 'a woman in her 30s' }, NO_DRAFT);
    expect(w['look-hair']).toBeUndefined();
    expect(w.describe).toBe('a woman in her 30s');
    // the details were about the same person and stay
    expect(w.traits).toEqual(['glasses', 'tattoo']);
    sound(w);
  });

  it('takes back what depended on a changed answer, and only that', () => {
    const typed = commit({}, { source: { door: 'scratch', via: 'typed' }, describe: 'tall with a hat' }, NO_DRAFT);
    expect(nextQuestion(typed, NO_DRAFT)).toBe('gaps');
    const a = commit(typed, { gaps: { who: 'woman', age: '30s', build: 'lean' }, traits: [] }, NO_DRAFT);
    expect(nextQuestion(a, NO_DRAFT)).toBeNull();
    // the sentence changed, so the follow-up about it goes, and is asked again
    const b = commit(a, { describe: 'short with a beard' }, NO_DRAFT);
    expect(b.gaps).toBeUndefined();
    // what was said about the person after the sentence was not said about the sentence
    expect(b.traits).toEqual([]);
    expect(nextQuestion(b, NO_DRAFT)).toBe('gaps');
    sound(b);
    // a sentence that says everything leaves nothing to ask, and nothing is stuck
    const c = commit(a, { describe: 'a woman in her 30s with a lean build and short black hair' }, NO_DRAFT);
    expect(descriptionGaps(c.describe as string)).toEqual([]);
    expect(nextQuestion(c, NO_DRAFT)).toBeNull();
    sound(c);
    // the same sentence again changes nothing
    expect(commit(a, { describe: 'tall with a hat' }, NO_DRAFT)).toEqual(a);
  });

  it('removes one detail without touching the others', () => {
    const three: Answers = {
      ...TAPPED,
      traits: ['glasses', 'tattoo', 'scar'],
      'trait-scar': { words: 'a small scar on the chin', refs: [] },
    };
    sound(three);
    const b = commit(three, { traits: ['glasses', 'scar'] }, NO_DRAFT);
    expect(b['trait-tattoo']).toBeUndefined();
    expect(b['trait-tattoo-where']).toBeUndefined();
    expect(b['trait-glasses']?.words).toBe('thin black rectangular metal frames');
    expect(b['trait-scar']?.words).toBe('a small scar on the chin');
    expect(nextQuestion(b, NO_DRAFT)).toBeNull();
    // 11: the pictures of the tattoo went with it
    expect(traitDetails(b).tattoo).toBeUndefined();
    sound(b);
  });

  it('adds a detail back and asks only its own question', () => {
    const two = commit(TAPPED, { traits: ['glasses'] }, NO_DRAFT);
    const b = commit(two, { traits: ['glasses', 'tattoo'] }, NO_DRAFT);
    // it is asked again from nothing: the old answer does not come back
    expect(b['trait-tattoo']).toBeUndefined();
    expect(nextQuestion(b, NO_DRAFT)).toBe('trait-tattoo');
    expect(b['trait-glasses']?.words).toBe('thin black rectangular metal frames');
    sound(b);
    // answered, it asks where, and then nothing
    const c = commit(b, { 'trait-tattoo': { words: 'a small geometric line tattoo', refs: [] } }, NO_DRAFT);
    expect(nextQuestion(c, NO_DRAFT)).toBe('trait-tattoo-where');
    // words that already say where skip the placement question
    const d = commit(b, { 'trait-tattoo': { words: 'a script tattoo along the left forearm', refs: [] } }, NO_DRAFT);
    expect(nextQuestion(d, NO_DRAFT)).toBeNull();
    sound(d);
  });

  it('replaces words of their own with a tap, and a tap with words, leaving no trace', () => {
    const a = commit(TAPPED, { 'look-hair': 'dark auburn with a silver streak' }, NO_DRAFT);
    expect(a['look-hair']).toBe('dark auburn with a silver streak');
    const b = commit(a, { 'look-hair': 'blonde' }, NO_DRAFT);
    expect(b['look-hair']).toBe('blonde');
    expect(JSON.stringify(b)).not.toContain('auburn');
    sound(b);
  });

  it('keeps the pictures of a detail while its words change, and places it again', () => {
    const a = commit(TAPPED, { 'trait-tattoo': { words: 'a solid blackwork tattoo', refs: ['h-ink'] } }, NO_DRAFT);
    expect(a['trait-tattoo']?.refs).toEqual(['h-ink']);
    // the placement was given about the old tattoo
    expect(a['trait-tattoo-where']).toBeUndefined();
    expect(nextQuestion(a, NO_DRAFT)).toBe('trait-tattoo-where');
    // a picture added changes nothing else
    const b = commit(
      TAPPED,
      { 'trait-tattoo': { ...TAPPED['trait-tattoo'], refs: ['h-ink', 'h-two'] } as Answers['trait-tattoo'] },
      NO_DRAFT,
    );
    expect(b['trait-tattoo-where']).toBe('on their right forearm');
    sound(b);
  });

  it('asks the photographs what stays only between the face and the set', () => {
    const p: Answers = { source: { door: 'photos', via: 'taps' }, photos: { hashes: ['h1'], attested: true } };
    // before the draft: the photographs are the question
    expect(nextQuestion(p, NO_DRAFT)).toBe('photos');
    // the draft holds them and the face stands: what stays is asked
    expect(nextQuestion(p, photosDraft())).toBe('traits');
    // the face is still being read: nothing yet
    expect(nextQuestion(p, { ...photosDraft(), draft: { ...photosDraft().draft!, stage: 'analyzing' } })).toBeNull();
    // a draft already told what stays is not asked again
    expect(nextQuestion(p, photosDraft('thin black frames'))).toBeNull();
    // but its own answer still reads back beside it
    const answered1 = commit(
      p,
      { traits: ['glasses'], 'trait-glasses': { words: 'thin black frames', refs: [] } },
      photosDraft(),
    );
    expect(answeredIn(answered1, photosDraft('thin black frames'))).toEqual([
      'source',
      'photos',
      'traits',
      'trait-glasses',
    ]);
    // no engine: nothing can be drawn from it, so it is not asked
    expect(nextQuestion(p, { ...photosDraft(), canGenerate: false })).toBeNull();
  });

  it('keys answers by id, so their order on disk means nothing', () => {
    const shuffled = Object.fromEntries(Object.entries(TAPPED).reverse()) as Answers;
    expect(answeredIn(shuffled, NO_DRAFT)).toEqual(answeredIn(TAPPED, NO_DRAFT));
    expect(nextQuestion(shuffled, NO_DRAFT)).toBeNull();
    // an id nobody knows is unsound, never a crash
    expect(unsound({ ...TAPPED, ['look-hat' as Qid]: 'x' } as Answers, NO_DRAFT)).toEqual(['look-hat']);
  });

  it('survives a long, changeable person without ever going unsound', () => {
    const ctx = NO_DRAFT;
    let a: Answers = {};
    const steps: Partial<Answers>[] = [
      { source: { door: 'scratch', via: 'taps' } },
      { 'look-who': 'woman' },
      { 'look-age': '30s' },
      { 'look-who': 'man' },
      { 'look-hair': '#7f3fbf' },
      { 'look-length': 'short' },
      { 'look-skin': 'tan' },
      { 'look-build': 'solid' },
      { traits: ['glasses', 'tattoo', 'scar'] },
      { 'trait-glasses': { words: 'rimless frames with thin temples', refs: [] } },
      { 'look-hair': 'black' },
      { 'trait-scar': { words: 'a thin pale scar through one eyebrow', refs: ['h-scar'] } },
      { traits: ['glasses', 'scar'] },
      { traits: ['glasses', 'scar', 'piercing'] },
      { 'trait-piercing': { words: 'a silver septum ring', refs: [] } },
      { keep: 'always a red thread bracelet' },
      { 'look-age': '50s' },
      { source: { door: 'photos', via: 'taps' } },
      { photos: { hashes: ['h1', 'h2'], attested: true } },
      { source: { door: 'scratch', via: 'typed' }, describe: 'someone kind' },
      { gaps: 'skipped' },
      { traits: [] },
      { describe: 'a kind man in his 60s' },
    ];
    for (const patch of steps) {
      a = commit(a, patch, ctx);
      sound(a, ctx);
    }
    expect(a).toEqual({ source: { door: 'scratch', via: 'typed' }, describe: 'a kind man in his 60s', traits: [] });
    expect(nextQuestion(a, ctx)).toBeNull();
  });
});
