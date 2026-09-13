import { describe, it, expect } from 'vitest';
import {
  caretFromLine,
  caretOnLine,
  composingEvent,
  emptyInsertCopy,
  enterSubmits,
  insertLabel,
  menuFromInput,
  neededInsertHeight,
  pickInsertCaret,
  placeOnScroll,
  sameInsertPos,
  shouldAskMore,
  splitMatch,
} from '../src/composer/insertMenu.js';

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
    expect(insertLabel('$')).toBe('Products');
    expect(insertLabel('/')).toBe('Scenes');
    expect(insertLabel('@')).toBe('Presenters');
    expect(insertLabel('#')).toBe('Colors');
  });
});

describe('emptyInsertCopy', () => {
  it('names the trigger, not a generic empty catalog', () => {
    expect(emptyInsertCopy('$')).toBe('No matching products');
    expect(emptyInsertCopy('/')).toBe('No matching scenes');
    expect(emptyInsertCopy('#')).toBe('No matching colours');
    expect(emptyInsertCopy('@')).toBe('No matching presenters');
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

describe('enterSubmits', () => {
  it('fires the shot when nothing else wanted the key', () => {
    expect(enterSubmits({ menuOpen: false, handled: false })).toBe(true);
  });

  it('holds while the insert menu is open', () => {
    expect(enterSubmits({ menuOpen: true, handled: false })).toBe(false);
  });

  it('holds when the menu took the key and closed itself inside the same event', () => {
    // The state says no menu, because accepting a row closed it. Submitting
    // here fires the shot on the keystroke that placed the chip.
    expect(enterSubmits({ menuOpen: false, handled: true })).toBe(false);
  });
});

describe('placeOnScroll', () => {
  it('ignores a scroll that started inside the menu, so paging does not re-anchor', () => {
    const menu = { contains: (n: unknown) => n === 'row' };
    expect(placeOnScroll('row', menu)).toBe(false);
    expect(placeOnScroll(menu, menu)).toBe(false);
  });

  it('still places when the window or the composer scrolls', () => {
    const menu = { contains: () => false };
    expect(placeOnScroll(window, menu)).toBe(true);
    expect(placeOnScroll(null, menu)).toBe(true);
  });
});

describe('pickInsertCaret', () => {
  const live = { top: 700, bottom: 718, left: 40, right: 48 };
  const last = { top: 680, bottom: 698, left: 20, right: 28 };

  it('keeps the snapshot while the search field holds focus', () => {
    expect(pickInsertCaret(null, last, true)).toEqual(last);
    expect(pickInsertCaret(live, last, true)).toEqual(last);
  });

  it('follows a live caret, then the snapshot, once the brief has it again', () => {
    expect(pickInsertCaret(live, last, false)).toEqual(live);
    expect(pickInsertCaret(null, last, false)).toEqual(last);
  });
});

describe('caretOnLine', () => {
  it('rebuilds the same caret after the line moves', () => {
    const line = { top: 740, bottom: 780, left: 100, right: 500 };
    const caret = { top: 748, bottom: 766, left: 140, right: 148 };
    const moved = { ...line, top: 200, bottom: 240 };
    expect(caretFromLine(moved, caretOnLine(caret, line))).toEqual({
      top: 208,
      bottom: 226,
      left: 140,
      right: 148,
    });
  });
});

describe('sameInsertPos', () => {
  const box = { left: 10, top: 20, width: 320, maxHeight: 240, side: 'above', shell: 'caret' };
  it('is true when the box did not move', () => {
    expect(sameInsertPos(box, { ...box })).toBe(true);
    expect(sameInsertPos(null, null)).toBe(true);
  });

  it('is false when the box moved or is missing', () => {
    expect(sameInsertPos(box, { ...box, top: 21 })).toBe(false);
    expect(sameInsertPos(box, null)).toBe(false);
  });
});

describe('shouldAskMore', () => {
  it('asks once per already-drawn page, never twice for the same length', () => {
    expect(shouldAskMore(0, 8, 20)).toBe(true);
    expect(shouldAskMore(8, 8, 20)).toBe(false);
    expect(shouldAskMore(8, 16, 12)).toBe(true);
  });

  it('does not ask when the catalog is exhausted or the list is empty', () => {
    expect(shouldAskMore(0, 8, 0)).toBe(false);
    expect(shouldAskMore(0, 0, 20)).toBe(false);
  });
});

describe('neededInsertHeight', () => {
  it('grows from the list scroll height, not the last painted cap', () => {
    // A miss painted at 70px; `/qa` then has two rows (72px) plus 48px of chrome.
    expect(neededInsertHeight(48, 10, 320)).toBe(58);
    expect(neededInsertHeight(48, 72, 320)).toBe(120);
  });

  it('never exceeds the insert menu cap', () => {
    expect(neededInsertHeight(48, 400, 320)).toBe(320);
  });
});
