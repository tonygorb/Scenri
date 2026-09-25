import { describe, expect, it } from 'vitest';
import { type Question, type Turn, enterDecides } from '../src/conversation/question.js';
import { EMPTY_STATE } from '../src/create/presenter/creationState.js';
import { turnsFor } from '../src/create/presenter/presenterFlowRules.js';
import type { Answers } from '../src/create/presenter/presenterQuestions.js';
import { type DraftLike, emptySlot } from '../src/create/presenter/presenterStudioRules.js';

/**
 * Which decision Enter may answer with its first option. The shell checks the
 * keyboard is on the question; this is the half that reads the conversation:
 * the open decision, never while an answer is being changed, never one that
 * throws work away or orders draws nobody asked for.
 */
const ask = (q: Partial<Question & { kind: 'confirm' }> = {}): Turn => ({
  kind: 'question',
  question: {
    id: 'identity',
    kind: 'confirm',
    prompt: 'Use this person?',
    options: [{ id: 'use', label: 'Use' }],
    ...q,
  },
});
const said: Turn = { kind: 'scenri', id: 'hello', text: 'Here is the face.' };

describe('Enter decides', () => {
  it('the open decision', () => {
    expect(enterDecides([said, ask()])?.id).toBe('identity');
  });

  it('nothing when the open question is not a decision, or is an aside', () => {
    expect(enterDecides([said])).toBeNull();
    expect(enterDecides([ask({ quiet: true })])).toBeNull();
    expect(enterDecides([said, { kind: 'question', question: { id: 'name', kind: 'text', prompt: 'Name?' } }])).toBe(
      null,
    );
  });

  it('nothing while an answer is open for change: the question under it is dimmed and takes no answer', () => {
    const reopened: Turn = {
      kind: 'question',
      question: { id: 'look-age', kind: 'choice', prompt: 'How old?', options: [], reopened: true },
    };
    expect(enterDecides([reopened, ask({ id: 'agree' })])).toBeNull();
    const rewriting: Turn = { kind: 'you', id: 'describe', text: 'a woman', editing: true };
    expect(enterDecides([rewriting, ask({ id: 'agree' })])).toBeNull();
  });

  it('nothing for a decision marked as one a stray key must not make', () => {
    expect(enterDecides([ask({ noEnter: true })])).toBeNull();
  });
});

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
const approved = (hash: string) => ({ ...emptySlot(), status: 'approved' as const, hash });
const core: DraftLike = {
  source: 'synthetic',
  name: 'Ari',
  direction: 'a man in his 30s',
  views: {
    portrait: approved('p'),
    front: approved('f'),
    'three-quarter': approved('t'),
    back: emptySlot(),
    left: emptySlot(),
    right: emptySlot(),
  },
  activeView: null,
  stage: 'idle',
};
const last = (T: Turn[]) => T[T.length - 1];

describe('the decisions a stray Enter must not make', () => {
  it('"Add back and profile views?" orders three draws, so Enter never answers it', () => {
    const T = turnsFor({ state: { ...EMPTY_STATE, answers: TAPPED }, draft: core, canGenerate: true });
    const q = last(T);
    expect(q?.kind === 'question' && q.question.id).toBe('extras');
    expect(enterDecides(T)).toBeNull();
  });

  it('photographs nobody could read: the first way on deletes the draft, so Enter never answers it', () => {
    const photos: DraftLike = {
      ...core,
      source: 'photos',
      name: '',
      views: { ...core.views, portrait: emptySlot(), front: emptySlot(), 'three-quarter': emptySlot() },
      analysis: { photos: [{ index: 0, usable: false }] },
      sources: ['a'],
    } as DraftLike;
    const answers: Answers = { source: { door: 'photos', via: 'taps' }, photos: { hashes: ['a'], attested: true } };
    const T = turnsFor({ state: { ...EMPTY_STATE, answers }, draft: photos, canGenerate: true });
    const q = last(T);
    expect(q?.kind === 'question' && q.question.id).toBe('weakphotos');
    expect(enterDecides(T)).toBeNull();
  });
});
