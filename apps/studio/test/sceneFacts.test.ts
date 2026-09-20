import { describe, expect, it } from 'vitest';
import { sceneAttributes, sceneFactsLine, sceneTailLine } from '../src/views/sceneFacts.js';

describe('sceneAttributes', () => {
  it('reads the first few keywords, in the order they were written', () => {
    // a real record: us-1ec0f644, "Social Outframe"
    const attrs = sceneAttributes({
      keywords: ['cyclorama', 'cardboard', 'graphic', 'social', 'overhead', 'wideangle', 'playful', 'editorial'],
    });
    expect(attrs).toEqual(['cyclorama', 'cardboard', 'graphic', 'social', 'overhead']);
  });

  it('says nothing when a scene has too few to make a line', () => {
    // every demo-engine fixture carries exactly this
    expect(sceneAttributes({ keywords: ['demo'] })).toEqual([]);
    expect(sceneAttributes({ keywords: [] })).toEqual([]);
    expect(sceneAttributes({})).toEqual([]);
  });

  it('drops blanks and repeats rather than printing them', () => {
    expect(sceneAttributes({ keywords: ['silk', ' ', 'Silk', 'drape', 'folds'] })).toEqual(['silk', 'drape', 'folds']);
  });
});

describe('sceneFactsLine', () => {
  it('is the attribute line when there is one', () => {
    expect(sceneFactsLine({ keywords: ['motion', 'freeze', 'splash', 'flash'], lighting: 'Hard flash' })).toBe(
      'motion · freeze · splash · flash',
    );
  });

  it('falls back to what the light does, which every scene has', () => {
    expect(sceneFactsLine({ keywords: ['demo'], lighting: 'Demo light, low and warm from the left' })).toBe(
      'Demo light, low and warm from the left',
    );
  });

  it('is empty rather than broken when a scene has neither', () => {
    expect(sceneFactsLine({})).toBe('');
  });
});

describe('sceneTailLine', () => {
  it('gathers the facts nobody acts on into one sentence', () => {
    expect(
      sceneTailLine({
        verticals: ['Apparel', 'Accessories'],
        refs: ['a', 'b', 'c'],
        setups: [{ id: 'top-down' }, { id: 'wide' }],
      }),
    ).toBe('Filed under Apparel, Accessories · read from 3 photographs · 2 ways to shoot it.');
  });

  it('counts one of a thing in the singular', () => {
    expect(sceneTailLine({ refs: ['a'], setups: [{ id: 'wide' }] })).toBe(
      'Read from 1 photograph · 1 way to shoot it.',
    );
  });

  it('is empty for a scene that carries none of them', () => {
    expect(sceneTailLine({})).toBe('');
    expect(sceneTailLine({ verticals: [], refs: [], setups: [] })).toBe('');
  });
});
