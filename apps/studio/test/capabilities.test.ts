import { describe, expect, it } from 'vitest';
import { FORMATS } from '../src/composer/BriefInput.js';
import { capabilityOf, sizingOf, supportsFormat } from '../src/engines/capabilities.js';

/**
 * This map is a second copy of what the adapters in `packages/engines/*` do,
 * kept on the client so a shape can be dimmed before the send rather than
 * refused after it. These tests pin the two facts the UI actually acts on, so
 * a drift shows up here rather than as a control that lies.
 */
describe('engine capabilities', () => {
  it('lets every engine make every shape, except the one that refuses', () => {
    for (const f of FORMATS) {
      expect(supportsFormat('codex-cli', f.id), `codex ${f.id}`).toBe(true);
      expect(supportsFormat('openrouter', f.id), `openrouter ${f.id}`).toBe(true);
      expect(supportsFormat('fal', f.id), `fal ${f.id}`).toBe(true);
    }
    // replicate throws on a 4:5 request rather than return a square for it
    expect(supportsFormat('replicate', 'portrait')).toBe(false);
    expect(supportsFormat('replicate', 'square')).toBe(true);
    expect(supportsFormat('replicate', 'story')).toBe(true);
    expect(supportsFormat('replicate', 'landscape')).toBe(true);
  });

  it('knows which engines do nothing with the size they are given', () => {
    // these two reduce the request to a ratio, so draft and high are identical
    expect(sizingOf('openrouter')).toBe('ratio');
    expect(sizingOf('replicate')).toBe('ratio');
    // codex puts "1232x1536: " in the prompt and hopes
    expect(sizingOf('codex-cli')).toBe('advisory');
    expect(sizingOf('fal')).toBe('exact');
    expect(sizingOf('demo')).toBe('exact');
  });

  it('assumes an engine it has never heard of honours what it is given', () => {
    expect(sizingOf('something-new')).toBe('exact');
    expect(supportsFormat('something-new', 'portrait')).toBe(true);
    expect(capabilityOf('something-new').formats).toBeUndefined();
  });

  it('only ever names formats that exist', () => {
    const known = new Set(FORMATS.map((f) => f.id));
    for (const id of ['codex-cli', 'openrouter', 'replicate', 'fal', 'demo']) {
      for (const f of capabilityOf(id).formats ?? []) expect(known, `${id} lists ${f}`).toContain(f);
    }
  });
});
