import { describe, it, expect } from 'vitest';
import { NEVER_PRESETS, unusedPresets } from '../src/brand/neverPresets.js';

describe('NEVER_PRESETS', () => {
  it('is a short list of real, distinct prohibitions', () => {
    expect(NEVER_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(NEVER_PRESETS.length).toBeLessThanOrEqual(10);
    for (const p of NEVER_PRESETS) expect(p.trim()).toBe(p);
    expect(new Set(NEVER_PRESETS).size).toBe(NEVER_PRESETS.length);
  });
  // They are appended verbatim into `Brand rules — never: a, b, c.` — a preset
  // carrying a comma would read as two rules.
  it('carries nothing that would split the compiled line', () => {
    for (const p of NEVER_PRESETS) expect(p).not.toContain(',');
  });
});

describe('unusedPresets', () => {
  it('offers everything to a brand with no rules yet', () => {
    expect(unusedPresets([])).toEqual(NEVER_PRESETS);
    expect(unusedPresets(undefined)).toEqual(NEVER_PRESETS);
  });
  it('stops offering one that has been added', () => {
    const out = unusedPresets(['alcohol']);
    expect(out).not.toContain('alcohol');
    expect(out.length).toBe(NEVER_PRESETS.length - 1);
  });
  // A rule typed by hand should silence the chip for the same rule.
  it('matches regardless of case or stray whitespace', () => {
    expect(unusedPresets(['  Alcohol '])).not.toContain('alcohol');
    expect(unusedPresets(['COMPETITOR LOGOS IN FRAME'])).not.toContain('competitor logos in frame');
  });
  it('ignores rules that are not presets', () => {
    expect(unusedPresets(['no beige sofas'])).toEqual(NEVER_PRESETS);
  });
});
