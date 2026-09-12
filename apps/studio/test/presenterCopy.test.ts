import { describe, expect, it } from 'vitest';
import { stageHint } from '../src/create/presenter/presenterCopy.js';

/**
 * The stage's second line points at wherever the work actually is, and the
 * work is not always describing.
 */
describe('what the empty stage says under its sign', () => {
  it('points at the conversation while there is still something to describe', () => {
    expect(stageHint('look-hair')).toBe('Keep describing your presenter');
    expect(stageHint(null)).toBe('Keep describing your presenter');
  });

  it('asks for photographs where photographs are what is wanted', () => {
    expect(stageHint('photos')).toBe('Add their photos');
  });

  it('stops asking for more once there is nothing left to ask', () => {
    expect(stageHint('agree')).toBe('Ready when you are');
  });

  it('says one line whatever is being asked, so the sign never changes height', () => {
    const said = ['look-hair', 'photos', 'agree', null].map((q) => stageHint(q));
    expect(said.every((s) => !s.includes('\n') && s.length < 40)).toBe(true);
  });
});
