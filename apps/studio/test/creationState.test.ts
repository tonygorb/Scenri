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
    s = reduce(s, { type: 'answer', patch: { 'look-who': 'woman' }, ctx: NO_DRAFT });
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
    let s = reduce(EMPTY_STATE, { type: 'answer', patch: { ...scratch, 'look-who': 'woman' }, ctx: NO_DRAFT });
    s = reduce(s, { type: 'edit', id: 'look-who' });
    s = reduce(s, { type: 'say', id: 'look-who' });
    s = reduce(s, { type: 'text', text: 'someone' });
    s = reduce(s, { type: 'colour', hex: '#123456' });
    expect(s.editing).toBe('look-who');
    expect(s.colour).toEqual({ step: 'look-who', hex: '#123456' });
    s = reduce(s, { type: 'answer', patch: { 'look-who': 'man' }, ctx: NO_DRAFT });
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
      'look-who': 'woman',
      'look-age': '30s',
      'look-hair': 'brown',
      'look-length': 'long',
      'look-skin': 'olive',
      'look-build': 'lean',
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
    let s = reduce(EMPTY_STATE, { type: 'answer', patch: { ...scratch, 'look-who': 'woman' }, ctx: NO_DRAFT });
    s = reduce(s, { type: 'aside', aside: { said: 'hi', reply: 'Hi.', q: 'look-age', at: '1' } });
    s = reduce(s, { type: 'unsure', unsure: { said: 'blue', q: 'look-age', at: '2' } });
    // an answer settles the waiting sentence into the record
    s = reduce(s, { type: 'answer', patch: { 'look-age': '30s' }, ctx: NO_DRAFT });
    expect(s.unsure).toBeNull();
    expect(s.asides.map((a) => a.reply)).toEqual(['Hi.', UNSURE_LINE]);
    // the door changes: the age question is gone, and what was said at it goes too
    s = reduce(s, { type: 'answer', patch: { source: { door: 'photos', via: 'taps' } }, ctx: NO_DRAFT });
    expect(s.asides).toEqual([]);
  });

  it('remembers the answers and their revision, and nothing of the moment', () => {
    let s = reduce(EMPTY_STATE, { type: 'answer', patch: { ...scratch, 'look-who': 'woman' }, ctx: NO_DRAFT });
    s = reduce(s, { type: 'say', id: 'look-age' });
    s = reduce(s, { type: 'text', text: 'about forty' });
    s = reduce(s, { type: 'aside', aside: { said: 'hi', reply: 'Hi.', q: 'look-age', at: '1' } });
    const back = deserialize(serialize(s));
    expect(back).toEqual({ answers: s.answers, revision: s.revision });
    const r = reduce(EMPTY_STATE, { type: 'restore', ...(back as { answers: Answers; revision: number }) });
    expect(r.saying).toBeNull();
    expect(r.text).toBe('');
    expect(r.asides).toEqual([]);
    // what an older studio wrote is not carried, and a question the table lost is dropped
    expect(deserialize(JSON.stringify({ source: 'scratch', look: { who: 'woman' } }))).toBeNull();
    expect(deserialize(JSON.stringify({ v: 2, answers: { 'look-who': 'man', 'look-hat': 'x' }, revision: 3 }))).toEqual(
      {
        answers: { 'look-who': 'man' },
        revision: 3,
      },
    );
    expect(deserialize('not json')).toBeNull();
  });

  it('starts over with nothing but the words to begin from', () => {
    let s = reduce(EMPTY_STATE, { type: 'answer', patch: { ...scratch, 'look-who': 'woman' }, ctx: NO_DRAFT });
    s = reduce(s, { type: 'extras-declined' });
    const rev = s.revision;
    s = reduce(s, { type: 'start-over', text: 'a man in his 40s' });
    expect(s.answers).toEqual({});
    expect(s.extrasDeclined).toBe(false);
    expect(s.text).toBe('a man in his 40s');
    expect(s.revision).toBe(rev + 1);
  });
});
