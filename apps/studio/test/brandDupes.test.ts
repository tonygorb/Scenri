import { describe, it, expect } from 'vitest';
import { duplicateOf } from '../src/views/brandDupes.js';
import type { Brand } from '../src/api.js';

const brand = (id: string, slug: string, name?: string, website?: string): Brand =>
  ({
    id,
    slug,
    json: { meta: { name, website } },
  }) as unknown as Brand;

const theia = brand('b1', 'theia', 'Theia', 'https://www.theia.co');

describe('the setup wizard duplicate guard', () => {
  it('matches an existing brand by normalized name', () => {
    expect(duplicateOf([theia], { name: '  THEIA ' })?.id).toBe('b1');
    expect(duplicateOf([theia], { name: 'Theia  Labs' })).toBeNull();
  });

  it('matches an existing brand by website host, however the URL is spelled', () => {
    expect(duplicateOf([theia], { url: 'theia.co' })?.id).toBe('b1');
    expect(duplicateOf([theia], { url: 'http://WWW.theia.co/shop/' })?.id).toBe('b1');
    expect(duplicateOf([theia], { url: 'other.co' })).toBeNull();
  });

  it('falls back to the slug when a brand has no display name', () => {
    const bare = brand('b2', 'acme');
    expect(duplicateOf([bare], { name: 'Acme' })?.id).toBe('b2');
  });

  it('never matches on empty probes or unparseable urls', () => {
    expect(duplicateOf([theia], {})).toBeNull();
    expect(duplicateOf([theia], { name: '   ' })).toBeNull();
    expect(duplicateOf([theia], { url: 'not a url at all' })).toBeNull();
  });
});
