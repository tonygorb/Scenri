import { describe, expect, it } from 'vitest';
import { shotWords } from '../src/shotWords.js';

describe('shotWords', () => {
  it('keeps the brief as the user wrote it and drops the directives that follow', () => {
    const prompt =
      'QA Single Shot Vase Field Watch on a marble ledge at dusk. The attached product image is the exact product: preserve its label.';
    expect(shotWords(prompt)).toBe('QA Single Shot Vase Field Watch on a marble ledge at dusk');
  });
  it('clips a long brief at a word and marks the cut', () => {
    const long = `${'a vase '.repeat(40)}on a ledge`;
    const words = shotWords(long, 40);
    expect(words?.length).toBeLessThanOrEqual(41);
    expect(words?.endsWith('…')).toBe(true);
  });
  it('has nothing to say for an empty prompt', () => {
    expect(shotWords('')).toBeNull();
    expect(shotWords(null)).toBeNull();
  });
});
