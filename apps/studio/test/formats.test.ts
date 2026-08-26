import { describe, it, expect } from 'vitest';
import { FORMATS, aspectOfFormat, formatOfShot } from '../src/composer/formats.js';

/**
 * The shape a refinement opens at.
 *
 * The regression this guards: the refine composer read one machine-wide pref,
 * so a shape chosen on one shot became the shape the next one opened at, and a
 * refine nobody had asked to reshape went out as a crop or an extend. The shape
 * now comes from the shot itself, and this is the function that reads it.
 */
describe('formatOfShot', () => {
  it('takes the recorded format, which is what a crop or an extend child stores', () => {
    expect(formatOfShot({ format: 'landscape' })).toBe('landscape');
    expect(formatOfShot({ format: 'portrait' })).toBe('portrait');
  });

  it('prefers the record over the pixels, so engine drift is not read as a reshape', () => {
    // codex answers a 4:5 request with 2:3, which is nearer Story by ratio.
    // Trusting the pixels there would open the composer on a shape the user
    // never asked for and claim a reshape on sight.
    expect(formatOfShot({ format: 'portrait', rendered: { sizes: [[1024, 1536]] } })).toBe('portrait');
  });

  it('falls back to the delivered pixels for a brief written before formats were stored', () => {
    expect(formatOfShot({ rendered: { sizes: [[1600, 900]] } })).toBe('landscape');
    expect(formatOfShot({ rendered: { sizes: [[1024, 1024]] } })).toBe('square');
    expect(formatOfShot({ rendered: { sizes: [[1080, 1920]] } })).toBe('story');
  });

  it('reads the frame the refine actually works from, not the run first', () => {
    const brief = {
      rendered: {
        sizes: [
          [1024, 1024],
          [1600, 900],
        ] as [number, number][],
      },
    };
    expect(formatOfShot(brief, 0)).toBe('square');
    expect(formatOfShot(brief, 1)).toBe('landscape');
    // a frame the record does not reach is not a shape claim
    expect(formatOfShot(brief, 2)).toBeUndefined();
  });

  it('says nothing when the shot says nothing, so no reshape is inferred', () => {
    expect(formatOfShot(null)).toBeUndefined();
    expect(formatOfShot(undefined)).toBeUndefined();
    expect(formatOfShot({})).toBeUndefined();
    expect(formatOfShot({ format: 'panorama' })).toBeUndefined();
    expect(formatOfShot({ rendered: { sizes: [[0, 0]] } })).toBeUndefined();
  });

  it('answers with an id the pickers and the reshape comparison can both resolve', () => {
    for (const f of FORMATS) {
      const id = formatOfShot({ rendered: { sizes: [[f.w, f.h]] } });
      expect(id).toBe(f.id);
      expect(aspectOfFormat(id)).toBeCloseTo(f.w / f.h, 10);
    }
  });
});
