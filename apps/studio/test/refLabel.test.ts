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
  });
  it('keys on the picture, never on the name', () => {
    expect(identityKeyOf({ t: 'ref', imageHash: 'abc123', label: 'Shot' })).toBe(
      identityKeyOf({ t: 'ref', imageHash: 'abc123', label: 'hero-ref' }),
    );
    expect(identityKeyOf({ t: 'ref', imageHash: 'abc123' })).toBe('r:abc123');
  });
});
