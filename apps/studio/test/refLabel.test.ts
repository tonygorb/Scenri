import { describe, expect, it } from 'vitest';
import { decode, encode, identityKeyOf } from '../src/composer/line.js';

// A reference chip says what it is: a shot, a file by its name, an image. The
// label rides the wire with the hash and comes back; the picture stays the
// identity, so the same image under two names is one chip.
describe('a reference token with a label', () => {
  it('round-trips through the wire format', () => {
    const t = { t: 'ref' as const, imageHash: 'abc123', label: 'Shot' };
    expect(encode(t)).toBe('r:abc123|Shot');
    expect(decode(encode(t))).toEqual(t);
    expect(decode('r:abc123')).toEqual({ t: 'ref', imageHash: 'abc123' });
    // a file named with a bar keeps its whole name
    expect(decode('r:abc123|a|b.png')).toEqual({ t: 'ref', imageHash: 'abc123', label: 'a|b.png' });
  });
  it('keys on the picture, never on the name', () => {
    expect(identityKeyOf({ t: 'ref', imageHash: 'abc123', label: 'Shot' })).toBe(
      identityKeyOf({ t: 'ref', imageHash: 'abc123', label: 'hero-ref' }),
    );
    expect(identityKeyOf({ t: 'ref', imageHash: 'abc123' })).toBe('r:abc123');
  });
});

describe('a scene token carrying a picked view', () => {
  const view = 'f'.repeat(32);
  it('round-trips with and without a setup, and a plain scene keeps its old spelling', () => {
    const t = { t: 'template' as const, id: 'block-tower', view, viewName: 'Close-up' };
    expect(encode(t)).toBe(`t:block-tower||${view}|Close-up`);
    expect(decode(encode(t))).toEqual(t);
    const set = { t: 'template' as const, id: 'block-tower', setup: 'wide', view, viewName: 'Hero' };
    expect(decode(encode(set))).toEqual(set);
    expect(encode({ t: 'template', id: 'block-tower' })).toBe('t:block-tower');
    expect(encode({ t: 'template', id: 'block-tower', setup: 'wide' })).toBe('t:block-tower|wide');
    expect(decode('t:block-tower|wide')).toEqual({ t: 'template', id: 'block-tower', setup: 'wide' });
  });
  it('is still one scene: a view is presentation, like a setup', () => {
    expect(identityKeyOf({ t: 'template', id: 'block-tower', view, viewName: 'Hero' })).toBe('t:block-tower');
  });
});
