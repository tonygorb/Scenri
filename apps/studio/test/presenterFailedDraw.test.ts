import { describe, expect, it } from 'vitest';
import type { Turn } from '../src/conversation/question.js';
import { EMPTY_STATE } from '../src/create/presenter/creationState.js';
import { turnsFor } from '../src/create/presenter/presenterFlowRules.js';
import type { Answers } from '../src/create/presenter/presenterQuestions.js';
import { type DraftLike, type StudioView, emptySlot } from '../src/create/presenter/presenterStudioRules.js';

/**
 * A failure nothing recognises (UXP-11) used to read "That did not go
 * through: <raw>. Nothing finished was touched." It now names what did not
 * draw and what is kept. The recognised ones are describeFailure's, and are
 * pinned where they are tested.
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
const faceUsed: DraftLike = {
  source: 'synthetic',
  name: 'Maren',
  views: { ...views(), portrait: { ...emptySlot(), status: 'approved', hash: 'p1' } },
  activeView: null,
  stage: 'idle',
};
const faceDrawn: DraftLike = {
  ...faceUsed,
  views: views(),
};
const said = (d: DraftLike, failedView: StudioView | null) => {
  const T: Turn[] = turnsFor({
    state: { ...EMPTY_STATE, answers: TAPPED },
    draft: d,
    canGenerate: true,
    failed: 'the engine fell over',
    failedView,
  });
  const t = T[T.length - 1];
  return t?.kind === 'question' ? t.question.prompt : '';
};

describe('a draw that never reached the engine', () => {
  it('names the view that did not draw, and keeps the face', () => {
    expect(said(faceUsed, 'front')).toBe(
      'The full body could not be drawn: the engine fell over. The face and everything else you had are kept.',
    );
  });

  it('names the face when it was the face', () => {
    expect(said(faceDrawn, 'portrait')).toBe(
      'The face could not be drawn: the engine fell over. Everything else you had is kept.',
    );
  });

  it('says what is kept when what failed was not a draw', () => {
    expect(said(faceUsed, null)).toBe('That did not go through: the engine fell over. Everything you had is kept.');
  });
});
