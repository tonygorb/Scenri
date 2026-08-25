import { describe, it, expect } from 'vitest';
import { byContextOrder, CONTEXT_KIND_ORDER, contextKindOf } from '../src/contextChips.js';

describe('the canonical context order', () => {
  it('reads product, presenter, scene, refs, mark, colors', () => {
    expect(CONTEXT_KIND_ORDER).toEqual(['product', 'presenter', 'scene', 'ref', 'mark', 'color']);
  });

  it('maps token kinds to display kinds, and non-context to null', () => {
    expect(contextKindOf({ t: 'character', id: 'c1' })).toBe('presenter');
    expect(contextKindOf({ t: 'template', id: 's1' })).toBe('scene');
    expect(contextKindOf({ t: 'mark', imageHash: 'h' })).toBe('mark');
    expect(contextKindOf({ t: 'text', v: 'x' })).toBeNull();
    expect(contextKindOf({ t: 'format', id: 'square', w: 1, h: 1 })).toBeNull();
  });

  it('sorts by the canonical order, unknown kinds last, ties stable', () => {
    const chips = [
      { kind: 'color', id: 1 },
      { kind: 'mystery', id: 2 },
      { kind: 'ref', id: 3 },
      { kind: 'product', id: 4 },
      { kind: 'ref', id: 5 },
    ];
    expect([...chips].sort(byContextOrder).map((c) => c.id)).toEqual([4, 3, 5, 1, 2]);
  });
});
