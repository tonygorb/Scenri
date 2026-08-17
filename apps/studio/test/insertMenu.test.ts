import { describe, it, expect } from 'vitest';
import { composingEvent, emptyInsertCopy, insertLabel, menuFromInput, splitMatch } from '../src/composer/insertMenu.js';

describe('splitMatch', () => {
  it('marks the first query term inside the label', () => {
    expect(splitMatch('Peach Soda', 'pea')).toEqual([
      { text: 'Pea', hit: true },
      { text: 'ch Soda', hit: false },
    ]);
  });

  it('is a no-op when the query is empty or missing', () => {
    expect(splitMatch('Ice Core', '')).toEqual([{ text: 'Ice Core', hit: false }]);
    expect(splitMatch('Ice Core', '  ')).toEqual([{ text: 'Ice Core', hit: false }]);
  });

  it('leaves the label alone when the term is not in it', () => {
    expect(splitMatch('Ice Core', 'rose')).toEqual([{ text: 'Ice Core', hit: false }]);
  });
});

describe('insertLabel', () => {
  it('names the catalog the sigil opens', () => {
    expect(insertLabel('/')).toBe('Products');
    expect(insertLabel('@')).toBe('Presenters');
    expect(insertLabel('#')).toBe('Scenes');
  });
});

describe('emptyInsertCopy', () => {
  it('names the trigger, not a generic empty catalog', () => {
    expect(emptyInsertCopy('#')).toBe('No matching scenes');
    expect(emptyInsertCopy('@')).toBe('No matching presenters');
    expect(emptyInsertCopy('/')).toBe('No matching products');
  });
});

describe('composingEvent', () => {
  it('is true during IME composition, so a sigil key does not open a menu', () => {
    expect(composingEvent({ isComposing: true })).toBe(true);
    expect(composingEvent({ nativeEvent: { isComposing: true } })).toBe(true);
    expect(composingEvent({ keyCode: 229 })).toBe(true);
    expect(composingEvent({ isComposing: false, keyCode: 65 })).toBe(false);
  });
});

describe('menuFromInput', () => {
  it('closes when the sigil is gone', () => {
    expect(menuFromInput(null, false)).toEqual({ open: false });
  });

  it('does not open from a paste, even when the caret sits in a sigil', () => {
    expect(menuFromInput({ sigil: '@', query: 'foo' }, true)).toEqual({ open: false });
  });

  it('keeps the live query while typing', () => {
    expect(menuFromInput({ sigil: '#', query: 'stu' }, false)).toEqual({
      open: true,
      sigil: '#',
      query: 'stu',
    });
  });
});
