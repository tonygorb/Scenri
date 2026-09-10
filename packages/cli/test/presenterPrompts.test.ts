import { describe, it, expect } from 'vitest';
import {
  CAPTURE_UNIFORM,
  CORE_VIEWS,
  EXTRA_VIEWS,
  PRESENTER_VIEWS,
  STUDIO_SET,
  keepFor,
  sideNote,
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

  it('carries the accepted identity edits as one clause after the record, so later views follow the change', () => {
    expect(
      whoIs('Mara', {
        promptName: 'a woman with dark waves',
        hair: 'dark waves',
        identityNotes: 'the wide-set eyes must survive',
        identityEdits: ['shorter hair', 'no glasses'],
      }),
    ).toBe(
      'a woman with dark waves, the wide-set eyes must survive, except as changed here: shorter hair; no glasses; the attached drawn views show the change',
    );
    expect(whoIs('Mara', { promptName: 'a woman', identityEdits: [] })).toBe('a woman');
    expect(whoIs('Mara', { promptName: '', identityEdits: ['shorter hair'] })).toBe(
      'Mara, except as changed here: shorter hair; the attached drawn views show the change',
    );
  });
});

describe('an ask on the face', () => {
  it('is not contradicted by the clause that holds the rest of the person still', () => {
    const blue = syntheticIdentitySubject('a woman in her late 30s, brown eyes', {
      adjustment: 'change her eyes to blue',
    });
    expect(blue).toContain('changed only in this: change her eyes to blue.');
    expect(blue).toContain('overrides anything below that describes it otherwise');
    // the ask is about the face, so the face is not also held identical; what
    // the person carries is held whatever the ask, so a nudge cannot quietly
    // take a tattoo or a prosthetic away with it
    expect(blue).toContain(
      'Otherwise identical to the attached image in the rest of the face, hair, age, build and marks and limbs',
    );
    const longer = syntheticIdentitySubject('a woman in her late 30s', { adjustment: 'longer hair' });
    expect(longer).toContain('Otherwise identical to the attached image in face, age, build and marks and limbs');
    const both = syntheticIdentitySubject('a woman', { adjustment: 'blue eyes and longer hair' });
    expect(both).toContain(
      'Otherwise identical to the attached image in the rest of the face, age, build and marks and limbs',
    );
    // an ask about nothing nameable still holds the person
    expect(syntheticIdentitySubject('a woman', { adjustment: 'make it warmer' })).toContain(
      'Otherwise identical to the attached image in face, hair, age, build and marks and limbs',
    );
  });

  it('is not contradicted when it is about a mark or a limb either', () => {
    const scar = syntheticIdentitySubject('a man in his 40s', {
      adjustment: 'a small scar through the left eyebrow',
    });
    // the scar is on the face and it is a mark, so neither is held identical
    expect(scar).toContain(
      'Otherwise identical to the attached image in the rest of the face, hair, age, build and their other marks and limbs',
    );
    const arm = syntheticIdentitySubject('a woman', { adjustment: 'a prosthetic left arm' });
    expect(arm).toContain(
      'Otherwise identical to the attached image in face, hair, age, build and their other marks and limbs',
    );
  });
});

describe('what stays the same about them', () => {
  it('is said in their own words, before any later change', () => {
    const plain = whoIs('Maren', { promptName: 'a woman in her 30s' });
    // with nothing kept, the words are exactly what they were
    expect(plain).toBe('a woman in her 30s');
    const kept = whoIs('Maren', { promptName: 'a woman in her 30s', keep: 'thin black glasses' });
    expect(kept).toContain('a woman in her 30s, who also has thin black glasses');
    expect(kept).toContain('drawn in this view whether or not the attached images show it');
    // a later change still reads last, so the newest instruction wins
    const both = whoIs('Maren', {
      promptName: 'a woman in her 30s',
      keep: 'thin black glasses',
      identityEdits: ['shorter hair'],
    });
    expect(both.indexOf('who also has')).toBeLessThan(both.indexOf('except as changed here'));
    expect(both).toContain('except as changed here: shorter hair; the attached drawn views show the change');
  });

  it('says whose left it is, only when a side is named', () => {
    expect(sideNote('a floral tattoo on her right forearm')).toContain('their own left and right');
    expect(sideNote('a septum piercing')).toBe('');
    expect(whoIs('Ilse', { promptName: 'a woman', keep: 'a scar through her left eyebrow' })).toContain(
      'their own left and right',
    );
  });

  it('goes to the views that can show it, and no further', () => {
    const face = 'thin black glasses and a scar through her left eyebrow';
    const body = 'a floral tattoo on her right forearm';
    const both = 'thin black glasses and a tattoo on her right forearm';
    // a face is not in a back view, and a forearm is not in a head-and-shoulders portrait
    expect(keepFor('back', face)).toBeUndefined();
    expect(keepFor('portrait', face)).toBe(face);
    expect(keepFor('portrait', body)).toBeUndefined();
    expect(keepFor('front', body)).toBe(body);
    expect(keepFor('back', body)).toBe(body);
    // anything we cannot place rides everywhere: leaving their words out is worse
    for (const v of PRESENTER_VIEWS) {
      expect(keepFor(v, both)).toBe(both);
      expect(keepFor(v, 'she is always in silver')).toBe('she is always in silver');
      expect(keepFor(v, '   ')).toBeUndefined();
      expect(keepFor(v, undefined)).toBeUndefined();
    }
  });

  it('tells a profile that it is a turn of the same body, not a mirror of it', () => {
    for (const v of ['left', 'right'] as const) {
      expect(viewSubject(v, 'Maren')).toContain('never a mirror image of it');
    }
    expect(viewSubject('front', 'Maren')).not.toContain('mirror');
    expect(viewSubject('back', 'Maren')).not.toContain('mirror');
  });
});
