import { describe, expect, it } from 'vitest';
import type { Question, Turn } from '../src/conversation/question.js';
import { EMPTY_STATE } from '../src/create/presenter/creationState.js';
import { composerFor, turnsFor } from '../src/create/presenter/presenterFlowRules.js';
import type { Answers } from '../src/create/presenter/presenterQuestions.js';
import { type DraftLike, emptySlot } from '../src/create/presenter/presenterStudioRules.js';

/**
 * The name is one question (UXP-7). It is asked while the face draws, and once
 * asked it stays until it is answered: a decision about a picture comes first
 * and keeps the line, but the name does not leave the conversation while that
 * decision is made, and it is not asked again later in other words.
 */
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
  traits: [],
};
const at = (s: number) => `2026-09-26T10:00:${String(s).padStart(2, '0')}.000Z`;
const slot = (over: Partial<ReturnType<typeof emptySlot>>) => ({ ...emptySlot(), ...over });
const draft = (over: Partial<DraftLike> = {}): DraftLike => ({
  source: 'synthetic',
  name: '',
  direction: 'a woman in her 30s',
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
  ...over,
});
const turns = (d: DraftLike, declined = false) =>
  turnsFor({ state: { ...EMPTY_STATE, answers: TAPPED, extrasDeclined: declined }, draft: d, canGenerate: true });
const questions = (T: Turn[]): Question[] => T.flatMap((t) => (t.kind === 'question' ? [t.question] : []));
const nameQ = (T: Turn[]) => questions(T).find((q) => q.id === 'name');
const last = (T: Turn[]) => {
  const t = T[T.length - 1];
  return t?.kind === 'question' ? t.question : null;
};

const faceDrawing = draft({
  views: { ...draft().views, portrait: slot({ status: 'generating' }) },
  activeView: 'portrait',
  stage: 'drawing',
});
const faceLanded = draft({
  views: { ...draft().views, portrait: slot({ status: 'candidate', hash: 'p1', attempts: 1 }) },
  results: [{ view: 'portrait', hash: 'p1', at: at(1), how: 'drawn' }],
});
const bodyLanded = draft({
  views: {
    ...draft().views,
    portrait: slot({ status: 'approved', hash: 'p1', attempts: 1 }),
    front: slot({ status: 'candidate', hash: 'f1', attempts: 1 }),
  },
  results: [
    { view: 'portrait', hash: 'p1', at: at(1), how: 'drawn' },
    { view: 'front', hash: 'f1', at: at(3), how: 'drawn' },
  ],
  decisions: [{ view: 'portrait', what: 'use', at: at(2) }],
});
const setDone = draft({
  views: {
    ...draft().views,
    portrait: slot({ status: 'approved', hash: 'p1', attempts: 1 }),
    front: slot({ status: 'approved', hash: 'f1', attempts: 1 }),
    'three-quarter': slot({ status: 'approved', hash: 't1', attempts: 1 }),
  },
  results: [
    { view: 'portrait', hash: 'p1', at: at(1), how: 'drawn' },
    { view: 'front', hash: 'f1', at: at(3), how: 'drawn' },
    { view: 'three-quarter', hash: 't1', at: at(5), how: 'drawn' },
  ],
  decisions: [
    { view: 'portrait', what: 'use', at: at(2) },
    { view: 'front', what: 'use', at: at(4) },
  ],
});

describe('the name, asked while the face draws', () => {
  const asked = nameQ(turns(faceDrawing));

  it('is asked while the face draws', () => {
    expect(asked).toBeDefined();
    expect(last(turns(faceDrawing))?.id).toBe('name');
  });

  it('stays when the face lands, and the decision about the face still comes first', () => {
    const T = turns(faceLanded);
    expect(nameQ(T)?.prompt).toBe(asked?.prompt);
    expect(last(T)?.id).toBe('identity');
  });

  it('stays through every later decision, in the same words', () => {
    const body = turns(bodyLanded);
    expect(nameQ(body)?.prompt).toBe(asked?.prompt);
    expect(last(body)?.id).toBe('view-revision');
    const extras = turns(setDone);
    expect(nameQ(extras)?.prompt).toBe(asked?.prompt);
    expect(last(extras)?.id).toBe('extras');
  });

  it('is the same question at the end, not a second one in other words', () => {
    const T = turns(setDone, true);
    expect(last(T)?.id).toBe('name');
    expect(last(T)?.prompt).toBe(asked?.prompt);
    expect(questions(T).filter((q) => q.id === 'name')).toHaveLength(1);
  });

  it('goes once it is answered', () => {
    const T = turns({ ...faceLanded, name: 'Maren' });
    expect(nameQ(T)).toBeUndefined();
    expect(T.some((t) => t.kind === 'you' && t.id === 'name' && t.text === 'Maren')).toBe(true);
  });
});

describe('the button beside a name typed while a picture is being decided', () => {
  const identity = last(turns(faceLanded));
  const typed = (text: string, d: DraftLike = faceLanded) =>
    composerFor(identity, { ...EMPTY_STATE, answers: TAPPED, text }, d, 'portrait');

  it('says Send for a bare name, because Enter names them and draws nothing', () => {
    expect(typed('Maren').action).toBe('Send');
  });

  it('says Refine for a change, because Enter redraws the face from it', () => {
    expect(typed('shorter hair').action).toBe('Refine');
  });

  it('says Refine for a bare name once they have one, because Enter then redraws', () => {
    expect(typed('Maren', { ...faceLanded, name: 'Noor' }).action).toBe('Refine');
  });
});
