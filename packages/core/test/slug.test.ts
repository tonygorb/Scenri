import { describe, it, expect } from 'vitest';
import { slugify, slugifyWithId, firstFree } from '../src/slug.js';

describe('slugify', () => {
  it('lowercases a plain English name', () => {
    expect(slugify('Acme Coffee')).toBe('acme-coffee');
  });

  it('folds Latin accents onto their base letter', () => {
    expect(slugify('café')).toBe('cafe');
    expect(slugify('Ñoño')).toBe('nono');
  });

  it('treats a letter with no accent-only decomposition (ß) as a separator, not content', () => {
    // ß has no NFKD decomposition to "ss" — it stays a single non-ASCII
    // codepoint, so it is dropped like any other non-Latin character rather
    // than silently misspelling the name
    expect(slugify('Straße')).toBe('stra-e');
  });

  it('treats punctuation, emoji and whitespace as separators', () => {
    expect(slugify('Acme, Inc.!')).toBe('acme-inc');
    expect(slugify('Hello 👋 World')).toBe('hello-world');
  });

  it('extracts only the Latin portion of a mixed-script name', () => {
    // this is nalla's real brand name: Hebrew label, dash, English word
    expect(slugify('נלה - Nalla')).toBe('nalla');
  });

  it('treats every non-Latin script as a separator, never as content', () => {
    // Hebrew, Arabic, Cyrillic, Greek, CJK — none of these should ever
    // appear as literal characters in a slug
    expect(slugify('מוצר חדש')).toBe('brand');
    expect(slugify('منتج جديد')).toBe('brand');
    expect(slugify('Новый продукт')).toBe('brand');
    expect(slugify('Νέο προϊόν')).toBe('brand');
    expect(slugify('新产品')).toBe('brand');
  });

  it('falls back to the given word when there is no usable Latin content', () => {
    expect(slugify('נלה', 'project')).toBe('project');
    expect(slugify('', 'set')).toBe('set');
    expect(slugify('   ', 'brand')).toBe('brand');
  });

  it('truncates to 48 characters without leaving a trailing hyphen', () => {
    const long = 'a'.repeat(60);
    const slug = slugify(long);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('never leaves a leading or trailing hyphen from stripped punctuation', () => {
    expect(slugify('!!!Acme!!!')).toBe('acme');
    expect(slugify('-Acme-')).toBe('acme');
  });
});

describe('slugifyWithId', () => {
  it('is identical to slugify when the name has usable Latin content', () => {
    expect(slugifyWithId('Acme Coffee', 'abc123def456')).toBe('acme-coffee');
    expect(slugifyWithId('נלה - Nalla', 'abc123def456')).toBe('nalla');
  });

  it('seeds the fallback with a slice of the id when the name has none', () => {
    expect(slugifyWithId('מוצר חדש', 'abc123def456789')).toBe('brand-abc123de');
  });

  it('keeps two different non-Latin-only names distinct via their own ids', () => {
    const a = slugifyWithId('מוצר ראשון', 'aaaaaaaa-0000');
    const b = slugifyWithId('מוצר שני', 'bbbbbbbb-0000');
    expect(a).not.toBe(b);
    expect(a).toBe('brand-aaaaaaaa');
    expect(b).toBe('brand-bbbbbbbb');
  });

  it('respects a custom fallback word', () => {
    expect(slugifyWithId('סדרה חדשה', 'deadbeef0000', 'project')).toBe('project-deadbeef');
  });
});

describe('firstFree', () => {
  it('returns the base candidate when it is free', () => {
    expect(firstFree('acme', () => false)).toBe('acme');
  });

  it('suffixes -2, -3, ... past the first collision', () => {
    const taken = new Set(['acme', 'acme-2']);
    expect(firstFree('acme', (c) => taken.has(c))).toBe('acme-3');
  });
});
