import { describe, expect, it } from 'vitest';
import { IDENTITY_CAP, IDENTITY_KINDS, describedKeys, photoCap } from '../src/composer/attachRoom.js';

const a = (role: string, id: string, extra: Record<string, unknown> = {}) =>
  ({ role, id, label: id, hash: `h-${id}`, ...extra }) as never;

describe('photoCap', () => {
  it('is the cap the preview reports', () => {
    expect(photoCap({ cap: 4 })).toBe(4);
  });
  it('is null for an engine that reads no images, and for a server that says nothing', () => {
    expect(photoCap({ cap: 0 })).toBeNull();
    expect(photoCap({})).toBeNull();
    expect(photoCap(null)).toBeNull();
  });
});

describe('describedKeys', () => {
  it('names the groups whose photo the budget left out', () => {
    const keys = describedKeys({
      cap: 2,
      attachments: [a('product', 'p1'), a('character', 'c1')],
      dropped: [a('product', 'p2', { reason: 'budget' }), a('character', 'c2', { reason: 'budget' })],
    });
    expect([...keys].sort()).toEqual(['character:c2', 'product:p2']);
  });
  it('a second angle dropped from a pictured group is not a described identity', () => {
    const keys = describedKeys({
      cap: 2,
      attachments: [a('product', 'p1'), a('character', 'c1')],
      dropped: [a('product', 'p1', { reason: 'budget' })],
    });
    expect(keys.size).toBe(0);
  });
  it('a missing photo is not described by the budget, and a blind engine describes nothing', () => {
    expect(describedKeys({ cap: 2, attachments: [], dropped: [a('product', 'p9', { reason: 'missing' })] }).size).toBe(
      0,
    );
    expect(describedKeys({ cap: 0, attachments: [], dropped: [a('product', 'p1', { reason: 'budget' })] }).size).toBe(
      0,
    );
    expect(describedKeys(null).size).toBe(0);
  });
});

describe('the ceilings', () => {
  it('every identity kind counts, colours and prose do not', () => {
    expect([...IDENTITY_KINDS].sort()).toEqual(['character', 'mark', 'product', 'ref', 'template']);
    expect(IDENTITY_KINDS.has('color')).toBe(false);
    expect(IDENTITY_KINDS.has('text')).toBe(false);
  });
  it('twelve identities per shot', () => {
    expect(IDENTITY_CAP).toBe(12);
  });
});
