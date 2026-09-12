import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATE,
  NO_DRAFT,
  UNSURE_LINE,
  deserialize,
  readyToDraw,
  reduce,
  serialize,
} from '../src/create/presenter/creationState.ts';
import type { Answers } from '../src/create/presenter/presenterQuestions.ts';

const scratch = { source: { door: 'scratch', via: 'taps' } } as const;

describe('the state of a presenter being made', () => {
  it('counts every change to the answers, and nothing else', () => {
    let s = reduce(EMPTY_STATE, { type: 'answer', patch: scratch, ctx: NO_DRAFT });
    expect(s.revision).toBe(1);
    s = reduce(s, { type: 'text', text: 'half a sen' });
    s = reduce(s, { type: 'say', id: 'look-hair' });
    expect(s.revision).toBe(1);
    // the same answer again is no change
    s = reduce(s, { type: 'answer', patch: scratch, ctx: NO_DRAFT });
    expect(s.revision).toBe(1);
    s = reduce(s, { type: 'answer', patch: { 'look-who': { pick: 'woman' } }, ctx: NO_DRAFT });
    expect(s.revision).toBe(2);
  });

  it('refuses a photograph that lands after the door changed', () => {
    let s = reduce(EMPTY_STATE, { type: 'answer', patch: { source: { door: 'photos', via: 'taps' } }, ctx: NO_DRAFT });
    s = reduce(s, { type: 'upload-begin' });
    // the person changes their mind while the upload runs
    s = reduce(s, { type: 'answer', patch: scratch, ctx: NO_DRAFT });
    const rev = s.revision;
    s = reduce(s, { type: 'uploaded', hash: 'h-late', max: 4 });
    s = reduce(s, { type: 'upload-end' });
    expect(s.answers.photos).toBeUndefined();
    expect(s.revision).toBe(rev);
    expect(s.uploading).toBe(0);
  });

  it('takes a photograph while the photographs are the question, once, up to the cap', () => {
    let s = reduce(EMPTY_STATE, { type: 'answer', patch: { source: { door: 'photos', via: 'taps' } }, ctx: NO_DRAFT });
    for (const h of ['a', 'b', 'a', 'c', 'd', 'e']) s = reduce(s, { type: 'uploaded', hash: h, max: 4 });
    expect(s.answers.photos?.hashes).toEqual(['a', 'b', 'c', 'd']);
    s = reduce(s, { type: 'remove-photo', hash: 'b' });
    s = reduce(s, { type: 'attest', checked: true });
    expect(s.answers.photos).toEqual({ hashes: ['a', 'c', 'd'], attested: true });
  });

  it('closes whatever was open when an answer lands', () => {
    let s = reduce(EMPTY_STATE, {
      type: 'answer',
      patch: { ...scratch, 'look-who': { pick: 'woman' } },
      ctx: NO_DRAFT,
    });
    s = reduce(s, { type: 'edit', id: 'look-who' });
    s = reduce(s, { type: 'say', id: 'look-who' });
    s = reduce(s, { type: 'text', text: 'someone' });
    s = reduce(s, { type: 'colour', hex: '#123456', step: 'look-who' });
    expect(s.editing).toBe('look-who');
    expect(s.colour).toEqual({ step: 'look-who', hex: '#123456' });
    s = reduce(s, { type: 'answer', patch: { 'look-who': { pick: 'man' } }, ctx: NO_DRAFT });
    expect(s.editing).toBeNull();
    expect(s.saying).toBeNull();
    expect(s.colour).toBeNull();
    expect(s.text).toBe('');
    // cancelling an edit changes no answer
    const before = s.answers;
    s = reduce(reduce(s, { type: 'edit', id: 'look-who' }), { type: 'cancel-edit' });
    expect(s.answers).toBe(before);
    expect(s.editing).toBeNull();
  });

  it('is ready to draw only when nothing stands open', () => {
    const full: Answers = {
      ...scratch,
      'look-who': { pick: 'woman' },
      'look-age': { pick: '30s' },
      'look-hair': { pick: 'brown' },
      'look-length': { pick: 'long' },
      'look-skin': { pick: 'olive' },
      'look-build': { pick: 'lean' },
      traits: [],
    };
    const s = reduce(EMPTY_STATE, { type: 'answer', patch: full, ctx: NO_DRAFT });
    expect(readyToDraw(s, NO_DRAFT)).toBe(true);
    expect(readyToDraw(reduce(s, { type: 'edit', id: 'look-hair' }), NO_DRAFT)).toBe(false);
    expect(readyToDraw(reduce(s, { type: 'say', id: 'keep' }), NO_DRAFT)).toBe(false);
    expect(readyToDraw(reduce(s, { type: 'answer', patch: { traits: ['scar'] }, ctx: NO_DRAFT }), NO_DRAFT)).toBe(
      false,
    );
  });

  it('keeps chatter where it was said, and drops it with the question it was said at', () => {
    let s = reduce(EMPTY_STATE, {
      type: 'answer',
      patch: { ...scratch, 'look-who': { pick: 'woman' } },
      ctx: NO_DRAFT,
    });
    s = reduce(s, { type: 'aside', aside: { said: 'hi', reply: 'Hi.', q: 'look-age', at: '1' } });
    s = reduce(s, { type: 'unsure', unsure: { said: 'blue', q: 'look-age', at: '2' } });
    // an answer settles the waiting sentence into the record
    s = reduce(s, { type: 'answer', patch: { 'look-age': { pick: '30s' } }, ctx: NO_DRAFT });
    expect(s.unsure).toBeNull();
    expect(s.asides.map((a) => a.reply)).toEqual(['Hi.', UNSURE_LINE]);
    // the door changes: the age question is gone, and what was said at it goes too
    s = reduce(s, { type: 'answer', patch: { source: { door: 'photos', via: 'taps' } }, ctx: NO_DRAFT });
    expect(s.asides).toEqual([]);
  });

  it('saying something again at a question takes that question back, answer and all', () => {
    // Tony's sequence: two strays at the length, then a real answer, then the
    // skin. Changing the first stray goes back to the length, so the answer
    // given after it and the skin that followed are both taken back.
    let s = reduce(EMPTY_STATE, { type: 'answer', patch: { ...scratch }, ctx: NO_DRAFT });
    for (const [id, v] of [
      ['look-who', 'woman'],
      ['look-age', '30s'],
      ['look-hair', 'blonde'],
    ] as const) {
      s = reduce(s, { type: 'answer', patch: { [id]: v }, ctx: NO_DRAFT });
    }
    s = reduce(s, { type: 'aside', aside: { said: 'lol3', reply: 'Not a length.', q: 'look-length', at: '1' } });
    s = reduce(s, { type: 'answer', patch: { 'look-length': { words: 'Lungo' } }, ctx: NO_DRAFT });
    s = reduce(s, { type: 'answer', patch: { 'look-skin': { pick: 'olive' } }, ctx: NO_DRAFT });
    expect(s.answers['look-length']).toEqual({ words: 'Lungo' });

    const back = reduce(s, {
      type: 'amend-aside',
      at: '1',
      said: 'lol34',
      reply: 'Still not a length.',
      kind: 'vague',
      ctx: NO_DRAFT,
    });
    expect(back.answers['look-length']).toBeUndefined();
    expect(back.answers['look-skin']).toBeUndefined();
    // and everything asked before it is exactly as it was
    expect(back.answers['look-hair']).toBe('blonde');
    expect(back.asides.map((a) => a.said)).toEqual(['lol34']);
    expect(back.revision).toBe(s.revision + 1);
  });

  it('a rewind takes back the sentences said after the point it reaches to', () => {
    const at = (n: string, q: string) => ({ said: n, reply: 'Say more.', q, at: n });
    let s = reduce(EMPTY_STATE, { type: 'answer', patch: { ...scratch }, ctx: NO_DRAFT });
    s = reduce(s, { type: 'answer', patch: { 'look-who': { pick: 'woman' } }, ctx: NO_DRAFT });
    s = reduce(s, { type: 'answer', patch: { 'look-age': { pick: '30s' } }, ctx: NO_DRAFT });
    s = reduce(s, { type: 'aside', aside: at('1', 'look-who') });
    s = reduce(s, { type: 'aside', aside: at('2', 'look-hair') });
    s = reduce(s, { type: 'aside', aside: at('3', 'look-length') });
    // the age is answered again: the hair and the length are asked again with
    // it, so what was said at them was said in a run that no longer happened
    const back = reduce(s, { type: 'answer', patch: { 'look-age': { pick: '50s' } }, ctx: NO_DRAFT });
    expect(back.answers['look-age']).toEqual({ pick: '50s' });
    expect(back.asides.map((a) => a.at)).toEqual(['1']);
    // answering the question a sentence was said at keeps it: it stands under
    // that exchange. What was said at a later question still goes.
    const on = reduce(s, { type: 'answer', patch: { 'look-hair': { pick: 'black' } }, ctx: NO_DRAFT });
    expect(on.asides.map((a) => a.at)).toEqual(['1', '2']);
  });

  it('a sentence said again takes the sentences said after it, and never an answer', () => {
    const said = (at: string, text: string) => ({ said: text, reply: 'Say more.', q: 'look-age', at });
    let s = reduce(EMPTY_STATE, {
      type: 'answer',
      patch: { ...scratch, 'look-who': { pick: 'woman' } },
      ctx: NO_DRAFT,
    });
    for (const a of [said('1', 'one'), said('2', 'two'), said('3', 'three')]) {
      s = reduce(s, { type: 'aside', aside: a });
    }
    const amended = reduce(s, {
      type: 'amend-aside',
      at: '2',
      said: 'two, again',
      reply: 'Still not it.',
      kind: 'vague',
      ctx: NO_DRAFT,
    });
    expect(amended.asides.map((a) => [a.at, a.said])).toEqual([
      ['1', 'one'],
      ['2', 'two, again'],
    ]);
    // the reply to new words is a new line, so it is written out again rather
    // than changing under the reader; the words keep their own id
    expect(amended.asides.at(-1)?.rev).toBe(1);
    const twice = reduce(amended, {
      type: 'amend-aside',
      at: '2',
      said: 'and again',
      reply: 'Nor that.',
      kind: 'vague',
      ctx: NO_DRAFT,
    });
    expect(twice.asides.at(-1)?.rev).toBe(2);
    // the answers before it stand: what was said at look-age is not about them
    expect(amended.answers['look-who']).toEqual({ pick: 'woman' });
    expect(amended.editing).toBeNull();
    // and one that turned out to be an answer takes the later ones with it too
    const dropped = reduce(s, { type: 'drop-aside', at: '2' });
    expect(dropped.asides.map((a) => a.at)).toEqual(['1']);
  });

  it('remembers the answers, their revision and what was said beside them, and nothing of the moment', () => {
    const said = { said: 'hi', reply: 'Hi.', q: 'look-age', at: '1' };
    let s = reduce(EMPTY_STATE, {
      type: 'answer',
      patch: { ...scratch, 'look-who': { pick: 'woman' } },
      ctx: NO_DRAFT,
    });
    s = reduce(s, { type: 'say', id: 'look-age' });
    s = reduce(s, { type: 'text', text: 'about forty' });
    s = reduce(s, { type: 'aside', aside: said });
    const back = deserialize(serialize(s));
    expect(back).toEqual({ answers: s.answers, revision: s.revision, asides: [said] });
    const r = reduce(EMPTY_STATE, { type: 'restore', ...(back as NonNullable<ReturnType<typeof deserialize>>) });
    // the half sentence and the question being said again are the moment, and
    // the moment is over; what a person typed and was answered is not
    expect(r.saying).toBeNull();
    expect(r.text).toBe('');
    expect(r.asides).toEqual([said]);
    // an aside missing any of its own parts is not carried
    const half = JSON.stringify({ v: 4, answers: {}, revision: 0, asides: [{ said: 'hi' }, said] });
    expect(deserialize(half)?.asides).toEqual([said]);
    // what an older studio wrote is not carried, and a question the table lost is dropped
    expect(deserialize(JSON.stringify({ source: 'scratch', look: { who: 'woman' } }))).toBeNull();
    // v3 kept no asides at all, and reads back with none rather than being refused
    expect(deserialize(JSON.stringify({ v: 3, answers: { 'look-who': { pick: 'man' } }, revision: 1 }))).toEqual({
      answers: { 'look-who': { pick: 'man' } },
      revision: 1,
      asides: [],
    });
    expect(
      deserialize(JSON.stringify({ v: 2, answers: { 'look-who': { pick: 'man' }, 'look-hat': 'x' }, revision: 3 })),
    ).toEqual({
      answers: { 'look-who': { pick: 'man' } },
      revision: 3,
      asides: [],
    });
    expect(deserialize('not json')).toBeNull();
  });

  it('starts over with nothing but the words to begin from', () => {
    let s = reduce(EMPTY_STATE, {
      type: 'answer',
      patch: { ...scratch, 'look-who': { pick: 'woman' } },
      ctx: NO_DRAFT,
    });
    s = reduce(s, { type: 'extras-declined' });
    const rev = s.revision;
    s = reduce(s, { type: 'start-over', text: 'a man in his 40s' });
    expect(s.answers).toEqual({});
    expect(s.extrasDeclined).toBe(false);
    expect(s.text).toBe('a man in his 40s');
    expect(s.revision).toBe(rev + 1);
  });

  it('holds a picture the way it holds the words beside it: kept on an answer, put back on a cancel', () => {
    const chosen: Answers = { ...scratch, traits: ['tattoo'] };
    let s = reduce(EMPTY_STATE, { type: 'answer', patch: chosen, ctx: NO_DRAFT });
    // said in words, a picture added, then the line closed without an answer
    s = reduce(s, { type: 'say', id: 'trait-tattoo' });
    s = reduce(s, { type: 'ref', id: 'trait-tattoo', hash: 'h-first' });
    expect(s.answers['trait-tattoo']?.refs).toEqual(['h-first']);
    s = reduce(s, { type: 'say', id: 'trait-tattoo' });
    expect(s.answers['trait-tattoo']).toBeUndefined();

    // added and answered: the picture came with the answer and stays
    s = reduce(s, { type: 'say', id: 'trait-tattoo' });
    s = reduce(s, { type: 'ref', id: 'trait-tattoo', hash: 'h-kept' });
    s = reduce(s, {
      type: 'answer',
      patch: { 'trait-tattoo': { words: 'a solid blackwork tattoo', refs: ['h-kept'] } },
      ctx: NO_DRAFT,
    });
    expect(s.answers['trait-tattoo']).toEqual({ words: 'a solid blackwork tattoo', refs: ['h-kept'] });

    // opened again, the picture replaced, then cancelled: it is as it was
    s = reduce(s, { type: 'edit', id: 'trait-tattoo' });
    s = reduce(s, { type: 'ref', id: 'trait-tattoo', hash: 'h-other' });
    expect(s.answers['trait-tattoo']?.refs).toEqual(['h-other']);
    s = reduce(s, { type: 'cancel-edit' });
    expect(s.answers['trait-tattoo']).toEqual({ words: 'a solid blackwork tattoo', refs: ['h-kept'] });
  });

  it('keeps a picture of a detail only while the detail is chosen', () => {
    let s = reduce(EMPTY_STATE, { type: 'answer', patch: { ...scratch, traits: ['tattoo'] }, ctx: NO_DRAFT });
    s = reduce(s, { type: 'edit', id: 'trait-tattoo' });
    const rev = s.revision;
    s = reduce(s, { type: 'ref', id: 'trait-tattoo', hash: 'h-ink' });
    s = reduce(s, { type: 'ref', id: 'trait-tattoo', hash: 'h-ink' });
    // the picture landed once, the answer it belongs to is still open
    expect(s.answers['trait-tattoo']).toEqual({ refs: ['h-ink'] });
    expect(s.revision).toBe(rev + 1);
    expect(s.editing).toBe('trait-tattoo');
    // one picture of a thing: another chosen takes its place
    s = reduce(s, { type: 'ref', id: 'trait-tattoo', hash: 'h-other' });
    expect(s.answers['trait-tattoo']).toEqual({ refs: ['h-other'] });
    s = reduce(s, { type: 'ref', id: 'trait-tattoo', hash: 'h-ink' });
    s = reduce(s, { type: 'ref', id: 'trait-tattoo', hash: 'h-ink', remove: true });
    expect(s.answers['trait-tattoo']).toEqual({ refs: [] });
    // a picture for a detail nobody chose is refused
    const t = reduce(s, { type: 'ref', id: 'trait-scar', hash: 'h-late' });
    expect(t.answers['trait-scar']).toBeUndefined();
    // and the pictures go with the detail
    const u = reduce(reduce(s, { type: 'ref', id: 'trait-tattoo', hash: 'h-ink' }), {
      type: 'answer',
      patch: { traits: [] },
      ctx: NO_DRAFT,
    });
    expect(u.answers['trait-tattoo']).toBeUndefined();
  });
});
