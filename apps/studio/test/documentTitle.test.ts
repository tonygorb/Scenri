import { describe, it, expect } from 'vitest';
import { titleFor } from '../src/documentTitle.js';

describe('titleFor', () => {
  it('names the section holding each surface', () => {
    expect(titleFor('/acme/create')).toBe('Create - Scenri');
    expect(titleFor('/acme/products')).toBe('Products - Scenri');
    expect(titleFor('/acme/scenes')).toBe('Scenes - Scenri');
    expect(titleFor('/acme/presenters')).toBe('Presenters - Scenri');
    expect(titleFor('/setup')).toBe('Set up - Scenri');
    expect(titleFor('/acme/kit')).toBe('Brand kit - Scenri');
  });

  it('names home, and keeps the bare word for a path it does not know', () => {
    expect(titleFor('/acme')).toBe('Home - Scenri');
    expect(titleFor('/')).toBe('Scenri');
    expect(titleFor('/b/old/thing')).toBe('Scenri');
  });

  it('names the thing on screen once it has one', () => {
    expect(titleFor('/acme/products/p1', '', 'Monolith')).toBe('Monolith - Scenri');
    expect(titleFor('/acme/scenes/s1', '', 'Salt Cavern')).toBe('Salt Cavern - Scenri');
    expect(titleFor('/acme/presenters/m1', '', 'Astrid')).toBe('Astrid - Scenri');
    expect(titleFor('/acme/sets/summer', '', 'Summer drop')).toBe('Summer drop - Scenri');
  });

  it('falls back to the section while a name is missing, never to undefined', () => {
    expect(titleFor('/acme/products/p1')).toBe('Products - Scenri');
    expect(titleFor('/acme/scenes/s1', '', null)).toBe('Scenes - Scenri');
    expect(titleFor('/acme/presenters/m1', '', '')).toBe('Presenters - Scenri');
    expect(titleFor('/acme/sets/summer', '', '   ')).toBe('Create - Scenri');
  });

  it('is the shot on a shot overlay, over the set underneath it', () => {
    expect(titleFor('/acme/create/shots/abc')).toBe('Shot - Scenri');
    expect(titleFor('/acme/sets/summer/shots/abc', '', 'Summer drop')).toBe('Shot - Scenri');
  });

  it('lets an open dialog name the tab, whatever is behind it', () => {
    expect(titleFor('/acme/products/p1', '?settings=brand', 'Monolith')).toBe('Settings - Scenri');
    expect(titleFor('/acme/create', '?setup=codex-cli')).toBe('Providers - Scenri');
    expect(titleFor('/acme', '?whatsnew=0.3.0')).toBe("What's new - Scenri");
    // Two open at once: the one stacked on top answers.
    expect(titleFor('/acme', '?settings=engines&setup=codex-cli')).toBe('Providers - Scenri');
  });

  it('leaves the create form to the surface it opened on', () => {
    expect(titleFor('/acme/products', '?new=product')).toBe('Products - Scenri');
  });

  it('takes a name as text, however it arrives', () => {
    // No markup is possible: document.title is never parsed. Whitespace,
    // newlines and control characters are, so they collapse.
    expect(titleFor('/acme/products/p1', '', '  Wide\n\tBottle  ')).toBe('Wide Bottle - Scenri');
    expect(titleFor('/acme/products/p1', '', '<b>Bottle</b>')).toBe('<b>Bottle</b> - Scenri');
    expect(titleFor('/acme/presenters/m1', '', 'مارين')).toBe('مارين - Scenri');
  });

  it('cuts a name no tab could draw', () => {
    const long = 'Dark Green Glass Olive Oil Bottle with a Brushed Steel Pour Spout';
    const title = titleFor('/acme/products/p1', '', long);
    expect(title.endsWith('… - Scenri')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(40 + ' - Scenri'.length);
    expect(titleFor('/acme/products/p1', '', 'x'.repeat(200)).length).toBeLessThanOrEqual(40 + ' - Scenri'.length);
  });
});
