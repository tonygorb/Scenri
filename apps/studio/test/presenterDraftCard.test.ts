import { describe, expect, it } from 'vitest';
import type { PresenterDraftSummary } from '../src/api.js';
import { draftState } from '../src/layout/PresenterDraftCard.js';

/**
 * What an unfinished person's card says about them.
 *
 * The line is the whole reason the card exists: somebody coming back to the
 * library wants to know whether the expensive part survived, not which
 * question they stopped at. It is also the line a phone hid until now, so it
 * is worth pinning what it can say.
 */
const draft = (over: Partial<PresenterDraftSummary> = {}): PresenterDraftSummary => ({
  id: 'pd-1',
  name: '',
  source: 'synthetic',
  updatedAt: '2026-09-12 00:00:00.000',
  createdAt: '2026-09-12 00:00:00.000',
  stage: 'idle',
  approved: 0,
  of: 3,
  drawing: false,
  ...over,
});

describe('how far along an unfinished person is', () => {
  it('says what is happening while something is being drawn, whatever else is true', () => {
    expect(draftState(draft({ drawing: true }))).toBe('Drawing');
    expect(draftState(draft({ drawing: true, approved: 2, hash: 'h' }))).toBe('Drawing');
  });

  it('tells a face waiting on a decision apart from nothing having been drawn', () => {
    // a card showing a face cannot say there is nothing there
    expect(draftState(draft({ hash: 'h' }))).toBe('A face to decide');
    expect(draftState(draft())).toBe('Not drawn yet');
    expect(draftState(draft({ source: 'photos' }))).toBe('Photos added');
  });

  it('counts what is decided, and says when there is nothing left to decide', () => {
    expect(draftState(draft({ approved: 1, hash: 'h' }))).toBe('Face ready');
    expect(draftState(draft({ approved: 2, of: 3, hash: 'h' }))).toBe('2 of 3 views ready');
    expect(draftState(draft({ approved: 3, of: 3, hash: 'h' }))).toBe('Ready to save');
    // the six-view set counts the same way
    expect(draftState(draft({ approved: 4, of: 6, hash: 'h' }))).toBe('4 of 6 views ready');
    expect(draftState(draft({ approved: 6, of: 6, hash: 'h' }))).toBe('Ready to save');
  });
});
