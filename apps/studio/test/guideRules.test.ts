import { describe, it, expect } from 'vitest';

/** En and em dash, spelled by code point so no dash sits in this file. */
const DASHES = String.fromCharCode(0x2013, 0x2014);
import { REFINE_HINT, hintFor, type HintInput } from '../src/guideRules.js';

/** Someone new, focused in the hub composer, with a finished shot on screen. */
const base: HintInput = {
  eligible: true,
  learned: [],
  overlay: false,
  refining: false,
  engineReady: true,
  engaged: true,
  attachOpen: false,
  refineHint: true,
  touring: false,
};

describe('the refine row', () => {
  it('offers refine once a finished shot is on screen and the brief has focus', () => {
    expect(hintFor(base)).toBe('refine');
  });

  it.each<[string, Partial<HintInput>]>([
    ['an install that was not new', { eligible: false }],
    ['inside an open shot', { overlay: true }],
    ['while refining', { refining: true }],
    ['while the engine banner owns the tray', { engineReady: false }],
    ['before the brief has had focus', { engaged: false }],
    ['while the attach panel is open', { attachOpen: true }],
    ['with no finished shot to open', { refineHint: false }],
    ['while a tour is on screen', { touring: true }],
    ['once learned', { learned: ['refine'] }],
  ])('says nothing %s', (_why, patch) => {
    expect(hintFor({ ...base, ...patch })).toBeNull();
  });

  it('reads plainly', () => {
    expect(REFINE_HINT).toBe('To refine a shot, open it and say what to change.');
    expect(REFINE_HINT).not.toMatch(new RegExp(`[${DASHES}!]`));
  });
});
