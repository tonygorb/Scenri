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
  LOOK_ORDER,
  commit,
  descriptionGaps,
  nextQuestion,
  traitDetails,
  unsound,
} from '../src/create/presenter/presenterQuestions.ts';

/** A person tapped all the way to the read-back, with two details answered. */
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
  traits: ['glasses', 'tattoo'],
  'trait-glasses': { pick: 'thin black rectangular metal frames', refs: [] },
  'trait-tattoo': { pick: 'a floral tattoo in soft grey shading', refs: ['h-ink'] },
  'trait-tattoo-where': { pick: 'on their right forearm' },
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
    const b = commit(a, { 'look-who': { pick: 'man' } }, NO_DRAFT);
    expect(nextQuestion(b, NO_DRAFT)).toBe('look-age');
    sound(b);
  });

  it('edits the same answer in place', () => {
    const a = commit({}, { source: { door: 'scratch', via: 'taps' }, 'look-who': { pick: 'man' } }, NO_DRAFT);
    const b = commit(a, { 'look-who': { pick: 'woman' } }, NO_DRAFT);
    expect(b['look-who']).toEqual({ pick: 'woman' });
    expect(answeredIn(b, NO_DRAFT)).toEqual(['source', 'look-who']);
    sound(b);
  });

  it('edits an answer three questions back and asks the rest of the run again', () => {
    const b = commit(TAPPED, { 'look-hair': { pick: 'blonde' } }, NO_DRAFT);
    expect(b['look-hair']).toEqual({ pick: 'blonde' });
    // the conversation carries on from the change: everything it asked after
    // the colour was answered to a run that no longer stands
    expect(b['look-length']).toBeUndefined();
    expect(b['look-facial']).toBeUndefined();
    expect(b['look-eyes']).toBeUndefined();
    expect(b['look-build']).toBeUndefined();
    expect(b['look-height']).toBeUndefined();
    expect(b.traits).toBeUndefined();
    expect(b['trait-tattoo']).toBeUndefined();
    expect(b['trait-tattoo-where']).toBeUndefined();
    // and what came before it is exactly as it was. Skin is asked before the
    // hair since 2026-09-12, when the rows were ordered the way a person
    // describes somebody, so it survives a colour changing.
    expect(b['look-who']).toEqual({ pick: 'woman' });
    expect(b['look-age']).toEqual({ pick: '30s' });
    expect(b['look-heritage']).toEqual({ pick: 'Mediterranean' });
    expect(b['look-skin']).toEqual({ pick: 'olive' });
    expect(nextQuestion(b, NO_DRAFT)).toBe('look-length');
    sound(b);
  });

  it('never asks a woman about facial hair, and asks everybody else', () => {
    const rows = (who: string) => {
      const a = commit({ source: { door: 'scratch', via: 'taps' } }, { 'look-who': { pick: who } }, NO_DRAFT);
      return LOOK_ORDER.filter((s) => applies(`look-${s}`, a, NO_DRAFT));
    };
    expect(rows('woman')).not.toContain('facial');
    expect(rows('man')).toContain('facial');
    expect(rows('androgynous')).toContain('facial');
    // the way past is not an answer of "woman", so the row still stands
    expect(rows('either')).toContain('facial');

    // and a run that reached the end without it is finished, not stuck: the
    // row that does not exist is not a row waiting to be answered
    const her: Answers = { ...TAPPED, 'look-who': { pick: 'woman' } };
    expect(unsound(her, NO_DRAFT)).toEqual([]);
    expect(nextQuestion(her, NO_DRAFT)).not.toBe('look-facial');

    // changing her to a man asks it, because the rows after who are asked again
    const him = commit(her, { 'look-who': { pick: 'man' } }, NO_DRAFT);
    expect(applies('look-facial', him, NO_DRAFT)).toBe(true);
  });

  it('changes nothing when the same answer is given again', () => {
    expect(commit(TAPPED, { 'look-hair': { pick: 'brown' } }, NO_DRAFT)).toEqual(TAPPED);
    expect(commit(TAPPED, { traits: ['glasses', 'tattoo'] }, NO_DRAFT)).toEqual(TAPPED);
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
    // and the run carries on from the door: what came after it is asked again
    expect(w.traits).toBeUndefined();
    expect(Object.keys(w).sort()).toEqual(['describe', 'source']);
    sound(w);
  });

  it('takes back the follow-up to a sentence, and asks the run again from it', () => {
    const typed = commit({}, { source: { door: 'scratch', via: 'typed' }, describe: 'tall with a hat' }, NO_DRAFT);
    expect(nextQuestion(typed, NO_DRAFT)).toBe('gaps');
    const a = commit(typed, { gaps: { who: 'woman', age: '30s', build: 'lean' }, traits: [] }, NO_DRAFT);
    expect(nextQuestion(a, NO_DRAFT)).toBeNull();
    // the sentence changed, so the follow-up about it goes, and so does the
    // rest of the run: it is asked again from there
    const b = commit(a, { describe: 'short with a beard' }, NO_DRAFT);
    expect(b.gaps).toBeUndefined();
    expect(b.traits).toBeUndefined();
    expect(nextQuestion(b, NO_DRAFT)).toBe('gaps');
    sound(b);
    // a sentence that says everything has no follow-up, and the run carries on
    const c = commit(a, { describe: 'a woman in her 30s with a lean build and short black hair' }, NO_DRAFT);
    expect(descriptionGaps(c.describe as string)).toEqual([]);
    expect(nextQuestion(c, NO_DRAFT)).toBe('traits');
    sound(c);
    // the same sentence again changes nothing
    expect(commit(a, { describe: 'tall with a hat' }, NO_DRAFT)).toEqual(a);
  });

  it('keeps what they volunteered about the person when something above it changes', () => {
    // the one exception to reading forward: nothing asks for this, so taking
    // it back does not ask again, it simply loses it
    const said = commit(
      commit(TAPPED, { traits: [] }, NO_DRAFT),
      { keep: { words: 'he has a prosthetic left arm', refs: [] } },
      NO_DRAFT,
    );
    sound(said);
    const b = commit(said, { 'look-hair': { pick: 'blonde' } }, NO_DRAFT);
    expect(b.keep?.words).toBe('he has a prosthetic left arm');
    sound(b);
    // and it still goes when the question it belongs to stops existing
    const c = commit(said, { source: { door: 'photos', via: 'taps' } }, NO_DRAFT);
    expect(c.keep).toBeUndefined();
    sound(c);
  });

  it('keeps the details it still has when the choosing changes', () => {
    const three: Answers = {
      ...TAPPED,
      traits: ['glasses', 'tattoo', 'scar'],
      'trait-scar': { pick: 'a small scar on the chin', refs: [] },
    };
    sound(three);
    const b = commit(three, { traits: ['glasses', 'scar'] }, NO_DRAFT);
    // the tattoo is gone with its placement and its pictures
    expect(b['trait-tattoo']).toBeUndefined();
    expect(b['trait-tattoo-where']).toBeUndefined();
    expect(traitDetails(b).tattoo).toBeUndefined();
    // and the two that were not touched are still answered: a detail is
    // answered about itself, so taking another one away says nothing about it
    expect(b['trait-glasses']).toEqual(TAPPED['trait-glasses']);
    expect(b['trait-scar']).toEqual(three['trait-scar']);
    expect(nextQuestion(b, NO_DRAFT)).toBeNull();
    sound(b);
    // one taken away and another taken in the same change: the one that went
    // goes with its placement, the new one is asked, and the two nobody
    // touched are still answered
    const c = commit(three, { traits: ['glasses', 'scar', 'piercing'] }, NO_DRAFT);
    expect(c['trait-tattoo']).toBeUndefined();
    expect(c['trait-tattoo-where']).toBeUndefined();
    expect(c['trait-glasses']).toEqual(TAPPED['trait-glasses']);
    expect(c['trait-scar']).toEqual(three['trait-scar']);
    expect(c['trait-piercing']).toBeUndefined();
    expect(nextQuestion(c, NO_DRAFT)).toBe('trait-piercing');
    sound(c);
  });

  it('asks a detail taken away and taken again from nothing', () => {
    const b = commit(TAPPED, { traits: ['glasses'] }, NO_DRAFT);
    expect(b['trait-tattoo']).toBeUndefined();
    const c = commit(b, { traits: ['glasses', 'tattoo'] }, NO_DRAFT);
    // nothing resurrects: a detail discarded and chosen again is asked again
    expect(c['trait-tattoo']).toBeUndefined();
    expect(c['trait-tattoo-where']).toBeUndefined();
    expect(nextQuestion(c, NO_DRAFT)).toBe('trait-tattoo');
    sound(c);
  });

  it('asks a detail added later, in the table order, from nothing', () => {
    const two = commit(TAPPED, { traits: ['glasses'] }, NO_DRAFT);
    const answered1 = commit(
      two,
      { 'trait-glasses': { pick: 'rimless frames with thin temples', refs: [] } },
      NO_DRAFT,
    );
    const b = commit(answered1, { traits: ['glasses', 'tattoo'] }, NO_DRAFT);
    // only the one taken in is asked: the glasses were not a reply to the chooser
    expect(b['trait-glasses']).toEqual(answered1['trait-glasses']);
    expect(b['trait-tattoo']).toBeUndefined();
    expect(nextQuestion(b, NO_DRAFT)).toBe('trait-tattoo');
    sound(b);
    const c = commit(b, { 'trait-glasses': { pick: 'tortoiseshell acetate frames', refs: [] } }, NO_DRAFT);
    expect(nextQuestion(c, NO_DRAFT)).toBe('trait-tattoo');
    // answered, a tattoo asks where it is
    const d = commit(c, { 'trait-tattoo': { pick: 'a small geometric line tattoo', refs: [] } }, NO_DRAFT);
    expect(nextQuestion(d, NO_DRAFT)).toBe('trait-tattoo-where');
    // words that already say where skip the placement question
    const e = commit(c, { 'trait-tattoo': { words: 'a script tattoo along the left forearm', refs: [] } }, NO_DRAFT);
    expect(nextQuestion(e, NO_DRAFT)).toBeNull();
    sound(e);
  });

  it('takes an answer away exactly as changing it does', () => {
    // Sending at an answer that is open for change takes it back, whatever was
    // sent, so this is now the call that carries a refusal as well as a
    // change. One rule, and it has to truncate the same way.
    const gone = commit(TAPPED, { 'look-hair': undefined }, NO_DRAFT);
    expect(gone['look-hair']).toBeUndefined();
    // everything the conversation asked after it goes with it
    expect(gone['look-length']).toBeUndefined();
    expect(gone['look-height']).toBeUndefined();
    expect(gone.traits).toBeUndefined();
    expect(gone['trait-tattoo']).toBeUndefined();
    // and what came before it is exactly as it was, the skin included: it is
    // asked before the hair, not after it
    expect(gone['look-who']).toEqual(TAPPED['look-who']);
    expect(gone['look-age']).toEqual(TAPPED['look-age']);
    expect(gone['look-skin']).toEqual(TAPPED['look-skin']);
    // the question is the one being asked again
    expect(nextQuestion(gone, NO_DRAFT)).toBe('look-hair');
    sound(gone);
    // which is the same shape as changing it, minus the new answer
    const changed = commit(TAPPED, { 'look-hair': { pick: 'blonde' } }, NO_DRAFT);
    expect(Object.keys(gone).sort()).toEqual(
      Object.keys(changed)
        .filter((k) => k !== 'look-hair')
        .sort(),
    );
  });

  it('counts the way past as an answer, though it says nothing about them', () => {
    // Skip contributes nothing to the sentence, which is not the same as
    // saying nothing: a row that measured answers by what they compile to
    // asked the skipped one again for ever, and the run could not move.
    const a = commit(
      { source: { door: 'scratch', via: 'taps' }, 'look-who': { pick: 'woman' } },
      { 'look-age': { pick: 'either' } },
      NO_DRAFT,
    );
    expect(answered('look-age', a, NO_DRAFT)).toBe(true);
    expect(nextQuestion(a, NO_DRAFT)).toBe('look-heritage');
    // and words beside the way past are still an answer of their own
    const b = commit(a, { 'look-age': { pick: 'either', words: 'not a teenager' } }, NO_DRAFT);
    expect(answered('look-age', b, NO_DRAFT)).toBe(true);
    // an empty pair is not an answer at all
    const c = commit(a, { 'look-age': {} }, NO_DRAFT);
    expect(answered('look-age', c, NO_DRAFT)).toBe(false);
    expect(nextQuestion(c, NO_DRAFT)).toBe('look-age');
  });

  it('keeps a chip and the words about it as one answer, and replaces each on its own', () => {
    // words of their own, with nothing tapped
    const a = commit(TAPPED, { 'look-hair': { words: 'dark auburn with a silver streak' } }, NO_DRAFT);
    expect(a['look-hair']).toEqual({ words: 'dark auburn with a silver streak' });
    // a tap over them, keeping the words: both halves stand
    const b = commit(a, { 'look-hair': { pick: 'blonde', words: 'with a silver streak' } }, NO_DRAFT);
    expect(b['look-hair']).toEqual({ pick: 'blonde', words: 'with a silver streak' });
    sound(b);
    // and words again over that: the chip is what it was, the words are new
    const c = commit(b, { 'look-hair': { pick: 'blonde', words: 'with darker roots' } }, NO_DRAFT);
    expect(c['look-hair']).toEqual({ pick: 'blonde', words: 'with darker roots' });
    expect(JSON.stringify(c)).not.toContain('silver');
    sound(c);
  });

  it('keeps the pictures of a detail while its words change, and places it again', () => {
    const a = commit(TAPPED, { 'trait-tattoo': { pick: 'a solid blackwork tattoo', refs: ['h-ink'] } }, NO_DRAFT);
    // the pictures belong to the detail, not to the words, so they stay
    expect(a['trait-tattoo']?.refs).toEqual(['h-ink']);
    // the placement was given about the old tattoo, so it is asked again
    expect(a['trait-tattoo-where']).toBeUndefined();
    expect(nextQuestion(a, NO_DRAFT)).toBe('trait-tattoo-where');
    // and what was chosen and answered before it is untouched
    expect(a['trait-glasses']?.pick).toBe('thin black rectangular metal frames');
    sound(a);
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
      { traits: ['glasses'], 'trait-glasses': { pick: 'thin black frames', refs: [] } },
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
    expect(unsound({ ...TAPPED, ['look-hat' as Qid]: { pick: 'x' } } as Answers, NO_DRAFT)).toEqual(['look-hat']);
  });

  it('survives a long, changeable person without ever going unsound', () => {
    const ctx = NO_DRAFT;
    let a: Answers = {};
    const steps: Partial<Answers>[] = [
      { source: { door: 'scratch', via: 'taps' } },
      { 'look-who': { pick: 'woman' } },
      { 'look-age': { pick: '30s' } },
      { 'look-who': { pick: 'man' } },
      { 'look-hair': { pick: '#7f3fbf' } },
      { 'look-length': { pick: 'short' } },
      { 'look-skin': { pick: 'tan', words: 'weathered' } },
      { 'look-build': { pick: 'solid' } },
      { traits: ['glasses', 'tattoo', 'scar'] },
      { 'trait-glasses': { pick: 'rimless frames with thin temples', refs: [] } },
      { 'look-hair': { pick: 'black' } },
      { 'trait-scar': { pick: 'a thin pale scar through one eyebrow', refs: ['h-scar'] } },
      { traits: ['glasses', 'scar'] },
      { traits: ['glasses', 'scar', 'piercing'] },
      { 'trait-piercing': { pick: 'a silver septum ring', words: 'high on the ear' } },
      { keep: { words: 'always a red thread bracelet', refs: [] } },
      { 'look-age': { pick: '50s' } },
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
    // the last thing said was the sentence, so the run carries on from it
    expect(a).toEqual({ source: { door: 'scratch', via: 'typed' }, describe: 'a kind man in his 60s' });
    expect(nextQuestion(a, ctx)).toBe('traits');
  });
});
