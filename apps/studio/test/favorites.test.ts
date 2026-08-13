import { describe, it, expect, beforeEach } from 'vitest';
import { favoriteScenes, toggleFavoriteScene } from '../src/favorites.js';

const BRAND = 'acme';
const CUR = `sc-favscenes-${BRAND}`;
const LOOKS = `sc-favlooks-${BRAND}`;
const OLD = `bt-favlooks-${BRAND}`;

beforeEach(() => localStorage.clear());

describe('favoriteScenes / toggleFavoriteScene', () => {
  it('is empty for a brand that has never starred anything', () => {
    expect(favoriteScenes(BRAND)).toEqual([]);
  });

  it('toggles a scene on and back off, and returns the new set', () => {
    expect(toggleFavoriteScene(BRAND, 'cold-table-clinic')).toEqual(['cold-table-clinic']);
    expect(favoriteScenes(BRAND)).toEqual(['cold-table-clinic']);
    expect(toggleFavoriteScene(BRAND, 'cold-table-clinic')).toEqual([]);
    expect(favoriteScenes(BRAND)).toEqual([]);
  });

  it('appends in the order stars were given — Home seeds the compose from the newest', () => {
    toggleFavoriteScene(BRAND, 'a');
    toggleFavoriteScene(BRAND, 'b');
    toggleFavoriteScene(BRAND, 'c');
    expect(favoriteScenes(BRAND)).toEqual(['a', 'b', 'c']);
  });

  it('unstarring the middle of the set leaves the rest in order', () => {
    toggleFavoriteScene(BRAND, 'a');
    toggleFavoriteScene(BRAND, 'b');
    toggleFavoriteScene(BRAND, 'c');
    expect(toggleFavoriteScene(BRAND, 'b')).toEqual(['a', 'c']);
  });

  it('keeps one brand out of another brand', () => {
    toggleFavoriteScene(BRAND, 'a');
    expect(favoriteScenes('other')).toEqual([]);
  });
});

// The one piece with real upgrade consequences: a plain rename would have
// silently reset every existing user's favourites.
describe('legacy key migration', () => {
  it('lifts the pre-scenri bt-favlooks-* value onto the current key and clears the old one', () => {
    localStorage.setItem(OLD, JSON.stringify(['a', 'b']));
    expect(favoriteScenes(BRAND)).toEqual(['a', 'b']);
    expect(localStorage.getItem(CUR)).toBe(JSON.stringify(['a', 'b']));
    expect(localStorage.getItem(OLD)).toBeNull();
  });

  it('lifts the pre-Scenes-rename sc-favlooks-* value the same way', () => {
    localStorage.setItem(LOOKS, JSON.stringify(['c']));
    expect(favoriteScenes(BRAND)).toEqual(['c']);
    expect(localStorage.getItem(CUR)).toBe(JSON.stringify(['c']));
    expect(localStorage.getItem(LOOKS)).toBeNull();
  });

  it('prefers the current key and leaves a stale legacy key alone', () => {
    localStorage.setItem(CUR, JSON.stringify(['new']));
    localStorage.setItem(LOOKS, JSON.stringify(['old']));
    localStorage.setItem(OLD, JSON.stringify(['older']));
    expect(favoriteScenes(BRAND)).toEqual(['new']);
    expect(localStorage.getItem(LOOKS)).toBe(JSON.stringify(['old']));
  });

  it('prefers the newer legacy spelling when both legacy keys exist', () => {
    localStorage.setItem(LOOKS, JSON.stringify(['looks']));
    localStorage.setItem(OLD, JSON.stringify(['bt']));
    expect(favoriteScenes(BRAND)).toEqual(['looks']);
  });

  it('migrates once — a second read does not walk the legacy keys again', () => {
    localStorage.setItem(OLD, JSON.stringify(['a']));
    favoriteScenes(BRAND);
    localStorage.setItem(OLD, JSON.stringify(['resurrected']));
    expect(favoriteScenes(BRAND)).toEqual(['a']);
  });
});

describe('malformed storage', () => {
  it('reads a torn value as no favourites rather than throwing on render', () => {
    localStorage.setItem(CUR, '{not json');
    expect(favoriteScenes(BRAND)).toEqual([]);
  });

  it('drops non-string entries — ids are the only thing a card can look up', () => {
    localStorage.setItem(CUR, JSON.stringify(['a', 3, null, { id: 'b' }, 'c']));
    expect(favoriteScenes(BRAND)).toEqual(['a', 'c']);
  });

  it('reads a non-array JSON value as no favourites', () => {
    localStorage.setItem(CUR, JSON.stringify({ a: true }));
    expect(favoriteScenes(BRAND)).toEqual([]);
  });

  it('recovers by overwriting on the next toggle', () => {
    localStorage.setItem(CUR, '{not json');
    expect(toggleFavoriteScene(BRAND, 'a')).toEqual(['a']);
    expect(favoriteScenes(BRAND)).toEqual(['a']);
  });
});
