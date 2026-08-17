import { describe, it, expect, beforeEach } from 'vitest';
import { bookmarkedScenes, toggleBookmarkScene } from '../src/bookmarks.js';

const BRAND = 'acme';
const CUR = `sc-favscenes-${BRAND}`;
const LOOKS = `sc-favlooks-${BRAND}`;
const OLD = `bt-favlooks-${BRAND}`;

beforeEach(() => localStorage.clear());

describe('bookmarkedScenes / toggleBookmarkScene', () => {
  it('is empty for a brand that has never bookmarked anything', () => {
    expect(bookmarkedScenes(BRAND)).toEqual([]);
  });

  it('toggles a scene on and back off, and returns the new set', () => {
    expect(toggleBookmarkScene(BRAND, 'cold-table-clinic')).toEqual(['cold-table-clinic']);
    expect(bookmarkedScenes(BRAND)).toEqual(['cold-table-clinic']);
    expect(toggleBookmarkScene(BRAND, 'cold-table-clinic')).toEqual([]);
    expect(bookmarkedScenes(BRAND)).toEqual([]);
  });

  it('appends in the order bookmarks were given — Home seeds the compose from the newest', () => {
    toggleBookmarkScene(BRAND, 'a');
    toggleBookmarkScene(BRAND, 'b');
    toggleBookmarkScene(BRAND, 'c');
    expect(bookmarkedScenes(BRAND)).toEqual(['a', 'b', 'c']);
  });

  it('removing the middle of the set leaves the rest in order', () => {
    toggleBookmarkScene(BRAND, 'a');
    toggleBookmarkScene(BRAND, 'b');
    toggleBookmarkScene(BRAND, 'c');
    expect(toggleBookmarkScene(BRAND, 'b')).toEqual(['a', 'c']);
  });

  it('keeps one brand out of another brand', () => {
    toggleBookmarkScene(BRAND, 'a');
    expect(bookmarkedScenes('other')).toEqual([]);
  });
});

// The one piece with real upgrade consequences: a plain rename would have
// silently reset every existing user's shortlist. The stored key keeps its
// historical spelling for exactly this reason — see src/bookmarks.ts.
describe('legacy key migration', () => {
  it('lifts the pre-scenri bt-favlooks-* value onto the current key and clears the old one', () => {
    localStorage.setItem(OLD, JSON.stringify(['a', 'b']));
    expect(bookmarkedScenes(BRAND)).toEqual(['a', 'b']);
    expect(localStorage.getItem(CUR)).toBe(JSON.stringify(['a', 'b']));
    expect(localStorage.getItem(OLD)).toBeNull();
  });

  it('lifts the pre-Scenes-rename sc-favlooks-* value the same way', () => {
    localStorage.setItem(LOOKS, JSON.stringify(['c']));
    expect(bookmarkedScenes(BRAND)).toEqual(['c']);
    expect(localStorage.getItem(CUR)).toBe(JSON.stringify(['c']));
    expect(localStorage.getItem(LOOKS)).toBeNull();
  });

  it('prefers the current key and leaves a stale legacy key alone', () => {
    localStorage.setItem(CUR, JSON.stringify(['new']));
    localStorage.setItem(LOOKS, JSON.stringify(['old']));
    localStorage.setItem(OLD, JSON.stringify(['older']));
    expect(bookmarkedScenes(BRAND)).toEqual(['new']);
    expect(localStorage.getItem(LOOKS)).toBe(JSON.stringify(['old']));
  });

  it('prefers the newer legacy spelling when both legacy keys exist', () => {
    localStorage.setItem(LOOKS, JSON.stringify(['looks']));
    localStorage.setItem(OLD, JSON.stringify(['bt']));
    expect(bookmarkedScenes(BRAND)).toEqual(['looks']);
  });

  it('migrates once — a second read does not walk the legacy keys again', () => {
    localStorage.setItem(OLD, JSON.stringify(['a']));
    bookmarkedScenes(BRAND);
    localStorage.setItem(OLD, JSON.stringify(['resurrected']));
    expect(bookmarkedScenes(BRAND)).toEqual(['a']);
  });
});

describe('malformed storage', () => {
  it('reads a torn value as no bookmarks rather than throwing on render', () => {
    localStorage.setItem(CUR, '{not json');
    expect(bookmarkedScenes(BRAND)).toEqual([]);
  });

  it('drops non-string entries — ids are the only thing a card can look up', () => {
    localStorage.setItem(CUR, JSON.stringify(['a', 3, null, { id: 'b' }, 'c']));
    expect(bookmarkedScenes(BRAND)).toEqual(['a', 'c']);
  });

  it('reads a non-array JSON value as no bookmarks', () => {
    localStorage.setItem(CUR, JSON.stringify({ a: true }));
    expect(bookmarkedScenes(BRAND)).toEqual([]);
  });

  it('recovers by overwriting on the next toggle', () => {
    localStorage.setItem(CUR, '{not json');
    expect(toggleBookmarkScene(BRAND, 'a')).toEqual(['a']);
    expect(bookmarkedScenes(BRAND)).toEqual(['a']);
  });
});
