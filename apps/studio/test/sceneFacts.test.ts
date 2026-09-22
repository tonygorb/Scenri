import { describe, expect, it } from 'vitest';
import { sceneTailLine } from '../src/views/sceneFacts.js';

describe('sceneTailLine', () => {
  it('gathers the facts nobody acts on into one sentence, after what the pictures are', () => {
    expect(sceneTailLine({ refs: ['a', 'b', 'c'], setups: [{ id: 'top-down' }, { id: 'wide' }] })).toBe(
      'Read from 3 photographs · 2 ways to shoot it.',
    );
    expect(
      sceneTailLine(
        { refs: ['a'] },
        'Shown in use with a Scenri demo product. Shots are told the words, never handed these pictures.',
      ),
    ).toBe(
      'Shown in use with a Scenri demo product. Shots are told the words, never handed these pictures. Read from 1 photograph.',
    );
  });

  it('counts one of a thing in the singular', () => {
    expect(sceneTailLine({ refs: ['a'], setups: [{ id: 'wide' }] })).toBe(
      'Read from 1 photograph · 1 way to shoot it.',
    );
  });

  it('is empty for a scene that carries none of them', () => {
    expect(sceneTailLine({})).toBe('');
    expect(sceneTailLine({ refs: [], setups: [] })).toBe('');
  });
});
