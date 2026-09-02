import { describe, expect, it } from 'vitest';
import { IDENTITY_CAP, IDENTITY_KINDS, PIXEL_ONLY, attachRoom, describedKeys } from '../src/composer/attachRoom.js';

const a = (role: string, id: string, extra: Record<string, unknown> = {}) =>
  ({ role, id, label: id, hash: `h-${id}`, ...extra }) as never;

describe('attachRoom', () => {
  it('counts distinct groups, kept and budget-dropped alike', () => {
    const room = attachRoom({
      cap: 4,
      attachments: [a('product', 'p1'), a('product', 'p1'), a('character', 'c1')],
      dropped: [a('reference', 'r1', { reason: 'budget' })],
    });
    expect(room).toEqual({ cap: 4, left: 1 });
  });
  it('a missing photo never held a slot', () => {
    const room = attachRoom({
      cap: 4,
      attachments: [a('product', 'p1')],
      dropped: [a('character', 'c9', { reason: 'missing' })],
    });
    expect(room).toEqual({ cap: 4, left: 3 });
  });
  it('goes negative when the carried context already overflows', () => {
    const room = attachRoom({
      cap: 4,
      attachments: [a('product', 'p1'), a('character', 'c1'), a('brand', 'b1'), a('reference', 'r1')],
      dropped: [a('product', 'p2', { reason: 'budget' }), a('character', 'c2', { reason: 'budget' })],
    });
    expect(room).toEqual({ cap: 4, left: -2 });
  });
  it('an engine that reads no images has no room to run out of', () => {
    expect(attachRoom({ cap: 0, attachments: [], dropped: [a('product', 'p1', { reason: 'budget' })] })).toBeNull();
    expect(attachRoom({ attachments: [], dropped: [] })).toBeNull();
    expect(attachRoom(null)).toBeNull();
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
  it('only a reference and a mark are nothing but their picture', () => {
    expect([...PIXEL_ONLY].sort()).toEqual(['mark', 'ref']);
  });
  it('twelve identities per shot', () => {
    expect(IDENTITY_CAP).toBe(12);
  });
});
