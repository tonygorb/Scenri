import { describe, it, expect } from 'vitest';
import { titleFor } from '../src/documentTitle.js';

describe('titleFor', () => {
  it('names each section, detail pages included', () => {
    expect(titleFor('/acme/create')).toBe('Create · scenri');
    expect(titleFor('/acme/create/shots/abc')).toBe('Create · scenri');
    expect(titleFor('/acme/sets/summer')).toBe('Create · scenri');
    expect(titleFor('/acme/sets/summer/shots/abc')).toBe('Create · scenri');
    expect(titleFor('/acme/products')).toBe('Products · scenri');
    expect(titleFor('/acme/products/p1')).toBe('Products · scenri');
    expect(titleFor('/acme/scenes')).toBe('Scenes · scenri');
    expect(titleFor('/acme/scenes/s1')).toBe('Scenes · scenri');
    expect(titleFor('/acme/presenters')).toBe('Presenters · scenri');
    expect(titleFor('/acme/presenters/m1')).toBe('Presenters · scenri');
    expect(titleFor('/setup')).toBe('Setup · scenri');
    expect(titleFor('/acme/kit')).toBe('Brand kit · scenri');
  });

  it('falls back to the studio for the home and anything unrecognised', () => {
    expect(titleFor('/')).toBe('scenri studio');
    expect(titleFor('/acme')).toBe('scenri studio');
    expect(titleFor('/b/old/thing')).toBe('scenri studio');
  });
});
