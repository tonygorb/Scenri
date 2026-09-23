import { describe, it, expect } from 'vitest';
import type { Pane } from '../src/app/dialogs.js';
import { PAGES, PAGE_OF, SETTINGS_INDEX, pageOf, startsOnIndex } from '../src/views/settingsPages.js';

const ids = PAGES.map((p) => p.id);

describe('Settings pages', () => {
  it('reads in the order a person scans: this brand, Scenri itself, then every delete', () => {
    expect(PAGES.map((p) => `${p.scope}:${p.label}`)).toEqual([
      'brand:Brand kit',
      'brand:Usage',
      'studio:Providers',
      'studio:Appearance',
      'studio:Library',
      'studio:Local access',
      'studio:Updates',
      'studio:About',
      'apart:Danger zone',
    ]);
  });

  it('no General: every page holds one idea', () => {
    expect(PAGES.map((p) => p.label)).not.toContain('General');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every pane id lands on a real page, and every page can be reached', () => {
    for (const [pane, page] of Object.entries(PAGE_OF)) expect(ids, pane).toContain(page);
    for (const id of ids) expect(Object.values(PAGE_OF), id).toContain(id);
  });

  // links, remedies and bookmarks from before the pages split
  it('the older ids still land', () => {
    expect(pageOf('general')).toBe('appearance');
    // the caps sit under the providers they cap
    expect(pageOf('budget')).toBe('engines');
    expect(pageOf('library')).toBe('library');
    expect(pageOf('appearance')).toBe('appearance');
    expect(pageOf('phone')).toBe('phone');
  });

  it('opened without a page, a desktop shows Brand kit and a phone the index', () => {
    expect(pageOf(SETTINGS_INDEX)).toBe('brand');
    expect(startsOnIndex(SETTINGS_INDEX)).toBe(true);
    expect(startsOnIndex(null)).toBe(true);
    expect(startsOnIndex('nonsense')).toBe(true);
  });

  // "Edit the kit first" and the /kit link used to land a phone on the index
  it('a phone sent to a page opens that page, Brand kit included', () => {
    for (const pane of Object.keys(PAGE_OF) as Pane[]) expect(startsOnIndex(pane), pane).toBe(false);
  });

  it('is not fooled by names every object has', () => {
    expect(pageOf('toString')).toBe('brand');
    expect(startsOnIndex('constructor')).toBe(true);
  });

  it('every sentence fits the one line a desktop gives it, and obeys the copy rules', () => {
    for (const p of PAGES) {
      const sub = p.sub('Aurelia');
      expect(sub.length, p.label).toBeLessThanOrEqual(80);
      expect(sub, p.label).not.toMatch(/[–—!]/);
    }
  });
});
