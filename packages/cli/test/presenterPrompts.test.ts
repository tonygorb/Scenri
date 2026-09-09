import { describe, it, expect } from 'vitest';
import {
  CAPTURE_UNIFORM,
  CORE_VIEWS,
  EXTRA_VIEWS,
  PRESENTER_VIEWS,
  STUDIO_SET,
  studioPrompt,
  viewSubject,
  syntheticIdentitySubject,
  whoIs,
} from '../src/presenterPrompts.js';

/**
 * The words every presenter view is drawn from. Pinned, because two things
 * downstream read them as a contract: the compiler's wardrobe-release clause
 * names the capture uniform as neutral base layers, and the curated roster
 * was drawn in the same set, so a person built here matches one we ship.
 */
describe('the capture setup is a contract', () => {
  it('keeps the uniform the compiler releases and the roster wears', () => {
    expect(CAPTURE_UNIFORM).toBe('a fitted off-white ribbed tank top and matching fitted off-white leggings, barefoot');
    expect(STUDIO_SET).toContain('solid seamless white studio background');
    expect(STUDIO_SET).toContain('never airbrushed');
  });

  it('leads with the full-bleed clause and ends with no text, no logos', () => {
    const p = studioPrompt('someone');
    expect(p.startsWith('Full-bleed photograph filling the entire frame')).toBe(true);
    expect(p).toContain(`someone, ${STUDIO_SET}.`);
    expect(p.endsWith('No text, no logos, no watermarks anywhere in the frame.')).toBe(true);
  });
});

describe('the six views: three core, three on request', () => {
  it('builds face, full body and three-quarter by default, and back, left, right on request', () => {
    expect(CORE_VIEWS).toEqual(['portrait', 'front', 'three-quarter']);
    expect(EXTRA_VIEWS).toEqual(['back', 'left', 'right']);
    expect(PRESENTER_VIEWS).toEqual([...CORE_VIEWS, ...EXTRA_VIEWS]);
  });

  it('every view after the face is the same person in the capture uniform, full length', () => {
    for (const v of PRESENTER_VIEWS) {
      if (v === 'portrait') continue;
      const s = viewSubject(v, 'who');
      expect(s).toContain(CAPTURE_UNIFORM);
      expect(s).toContain('full-length head-to-toe framing');
    }
  });

  it('portrait is head-and-shoulders, eyes to the lens, in the same backdrop', () => {
    const s = viewSubject('portrait', 'the exact person in the attached photographs');
    expect(s).toContain('head-and-shoulders portrait framing');
    expect(s).toContain('down to the collarbone');
    expect(s).toContain('eyes to the lens');
    expect(s.startsWith('the exact person in the attached photographs')).toBe(true);
  });

  it('front is full-length, standing, in the capture uniform', () => {
    const s = viewSubject('front', 'who');
    expect(s).toContain(CAPTURE_UNIFORM);
    expect(s).toContain('full-length head-to-toe framing');
    expect(s).toContain('facing the camera straight-on');
  });

  it('three-quarter is turned about forty-five degrees, both eyes in frame, the head with the body', () => {
    const s = viewSubject('three-quarter', 'who');
    expect(s).toContain('the same person');
    expect(s).toContain('about forty-five degrees');
    expect(s).toContain('both eyes stay in frame');
    expect(s).toContain('three-quarter view');
    expect(s).toContain('the head turned with the body');
    expect(s).toContain('their own hair exactly as the attached images show it');
  });

  it('left and right are the same person turned to a full profile, full length, in the uniform', () => {
    for (const side of ['left', 'right'] as const) {
      const s = viewSubject(side, 'who');
      expect(s).toContain('the same person');
      expect(s).toContain(CAPTURE_UNIFORM);
      expect(s).toContain('full-length head-to-toe framing');
      expect(s).toContain(`their ${side} side faces the camera`);
      expect(s).toContain('full profile');
    }
  });

  it('back is the same person facing away, full length, in the uniform', () => {
    const s = viewSubject('back', 'who');
    expect(s).toContain('the same person');
    expect(s).toContain(CAPTURE_UNIFORM);
    expect(s).toContain('directly away from the camera');
  });
});

describe('a person from a description', () => {
  it('is an adult, an original, and never a real or famous face', () => {
    const s = syntheticIdentitySubject('confident woman in her 40s, short silver hair');
    expect(s).toContain('confident woman in her 40s, short silver hair');
    expect(s).toMatch(/\badult\b/);
    expect(s).toMatch(/original person/);
    expect(s).toMatch(/does not resemble any real, famous or public figure/);
    // the identity roll is the portrait: the face is judged at face size
    expect(s).toContain('head-and-shoulders portrait framing');
    // realism over retouch, and grown-up bone structure
    expect(s).toMatch(/natural skin texture/);
    expect(s).toMatch(/no beauty filter/);
    expect(s).toMatch(/mature adult facial structure/);
  });

  it('carries a short adjustment when the person is being nudged, not replaced', () => {
    const s = syntheticIdentitySubject('a man in his 30s', { adjustment: 'shorter hair' });
    expect(s).toContain('the same person as the attached image');
    expect(s).toContain('shorter hair');
  });
});

describe('whoIs', () => {
  it('names the person from the record, hair once, notes after', () => {
    expect(whoIs('Mara', null)).toBe('the exact person in the attached photographs');
    expect(
      whoIs('Mara', {
        promptName: 'a woman with dark waves',
        hair: 'dark waves',
        identityNotes: 'the wide-set eyes must survive',
      }),
    ).toBe('a woman with dark waves, the wide-set eyes must survive');
    expect(whoIs('Mara', { promptName: 'a woman', hair: 'silver crop', identityNotes: '' })).toBe(
      'a woman, silver crop',
    );
  });
});
