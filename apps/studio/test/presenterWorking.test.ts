import { describe, expect, it } from 'vitest';
import { EMPTY_STATE } from '../src/create/presenter/creationState.js';
import { turnsFor, workingFor } from '../src/create/presenter/presenterFlowRules.js';
import type { Answers } from '../src/create/presenter/presenterQuestions.js';
import { type DraftLike, emptySlot } from '../src/create/presenter/presenterStudioRules.js';

/**
 * One wait, said once (UXP-8). A line in the log that says what is being
 * drawn or read is that wait; a Working turn under it said the same thing a
 * second time, and with the stage's badge a third.
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
const views = () => ({
  portrait: emptySlot(),
  front: emptySlot(),
  'three-quarter': emptySlot(),
  back: emptySlot(),
  left: emptySlot(),
  right: emptySlot(),
});
const draft = (over: Partial<DraftLike>): DraftLike => ({
  source: 'synthetic',
  name: '',
  views: views(),
  activeView: null,
  stage: 'idle',
  ...over,
});
const turns = (d: DraftLike) => turnsFor({ state: { ...EMPTY_STATE, answers: TAPPED }, draft: d, canGenerate: true });

const drawingFace = draft({
  views: { ...views(), portrait: { ...emptySlot(), status: 'generating' } },
  activeView: 'portrait',
  stage: 'drawing',
});
const drawingBody = draft({
  views: {
    ...views(),
    portrait: { ...emptySlot(), status: 'approved', hash: 'p1' },
    front: { ...emptySlot(), status: 'generating' },
  },
  activeView: 'front',
  stage: 'drawing',
});
const reading = draft({ source: 'photos', sources: ['s1'], stage: 'analyzing' });

describe('the Working turn', () => {
  it('stands down under the line that says the face is drawing', () => {
    const T = turns(drawingFace);
    expect(T.some((t) => t.kind === 'scenri' && t.id === 'drawing-face')).toBe(true);
    expect(workingFor(T, drawingFace, false)).toBe(false);
  });

  it('stands down under the line that says a view is drawing, even with a press on its way', () => {
    const T = turns(drawingBody);
    expect(T.some((t) => t.kind === 'scenri' && t.id === 'drawing-front')).toBe(true);
    expect(workingFor(T, drawingBody, true)).toBe(false);
  });

  it('stands down under the line that says the photos are being read', () => {
    expect(workingFor(turns(reading), reading, false)).toBe(false);
  });

  it('still says a draw or a read that no line in the log says', () => {
    expect(workingFor([], drawingFace, false)).toBe('Drawing');
    expect(workingFor([], reading, false)).toBe('Reading the photos');
  });

  it('still says a press on its way when nothing is drawing', () => {
    expect(workingFor([], null, true)).toBe(true);
    expect(workingFor([], null, false)).toBe(false);
  });
});
