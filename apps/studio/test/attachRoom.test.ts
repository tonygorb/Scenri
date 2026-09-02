import { describe, expect, it } from 'vitest';
import { attachRoom } from '../src/composer/attachRoom.js';

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
