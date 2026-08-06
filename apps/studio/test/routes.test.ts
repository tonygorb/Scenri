import { describe, it, expect } from 'vitest';
import {
  P,
  brandPath,
  hubPath,
  kitPath,
  lookPath,
  looksPath,
  rewriteLegacyPath,
  setPath,
  shotPath,
} from '../src/routes.js';

const brand = { slug: 'nalla' };
const set = { slug: 'spring-campaign' };

describe('path builders', () => {
  it('puts the brand at the root, with no prefix segment', () => {
    expect(brandPath(brand)).toBe('/nalla');
  });

  it('spells every section as a word', () => {
    expect(kitPath(brand)).toBe('/nalla/kit');
    expect(looksPath(brand)).toBe('/nalla/looks');
    expect(lookPath(brand, 'soft-daylight')).toBe('/nalla/looks/soft-daylight');
    expect(hubPath(brand)).toBe('/nalla/create');
    expect(setPath(brand, set)).toBe('/nalla/sets/spring-campaign');
  });

  it('opens a shot under whichever surface is holding it', () => {
    expect(shotPath(brand, null, 'n1')).toBe('/nalla/create/shots/n1');
    expect(shotPath(brand, set, 'n1')).toBe('/nalla/sets/spring-campaign/shots/n1');
  });

  it('never emits a single-letter segment', () => {
    const paths = [
      brandPath(brand),
      kitPath(brand),
      looksPath(brand),
      lookPath(brand, 'soft-daylight'),
      hubPath(brand),
      setPath(brand, set),
      shotPath(brand, null, 'n1'),
      shotPath(brand, set, 'n1'),
    ];
    for (const p of paths) {
      for (const seg of p.split('/').filter(Boolean)) expect(seg.length).toBeGreaterThan(1);
    }
  });

  it('agrees with the patterns the route table uses', () => {
    expect(P.brand).toBe('/:brandSlug');
    expect(P.setShot).toBe('/:brandSlug/sets/:setSlug/shots/:shotId');
  });
});

describe('rewriteLegacyPath', () => {
  it('drops the /b/ prefix', () => {
    expect(rewriteLegacyPath('/b/nalla')).toBe('/nalla');
  });

  it('renames the stuttering brand page to the kit', () => {
    expect(rewriteLegacyPath('/b/nalla/brand')).toBe('/nalla/kit');
  });

  it('keeps the hub, with or without a shot open', () => {
    expect(rewriteLegacyPath('/b/nalla/create')).toBe('/nalla/create');
    expect(rewriteLegacyPath('/b/nalla/create/n/8f3e')).toBe('/nalla/create/shots/8f3e');
  });

  it('spells /s/ as sets, with or without a shot open', () => {
    expect(rewriteLegacyPath('/b/nalla/s/spring')).toBe('/nalla/sets/spring');
    expect(rewriteLegacyPath('/b/nalla/s/spring/n/8f3e')).toBe('/nalla/sets/spring/shots/8f3e');
  });

  it('leaves looks alone, since they were always spelled out', () => {
    expect(rewriteLegacyPath('/b/nalla/looks')).toBe('/nalla/looks');
    expect(rewriteLegacyPath('/b/nalla/looks/soft-daylight')).toBe('/nalla/looks/soft-daylight');
  });

  it('still answers for the two shapes that were legacy before this rename', () => {
    // projects became sets; their shots are on the hub
    expect(rewriteLegacyPath('/b/nalla/p/project-5')).toBe('/nalla/create');
    expect(rewriteLegacyPath('/b/nalla/p/project-5/n/8f3e')).toBe('/nalla/create');
    // a shot at the brand root, from before the overlay moved under the hub
    expect(rewriteLegacyPath('/b/nalla/n/8f3e')).toBe('/nalla/create/shots/8f3e');
  });

  it('carries the query string across', () => {
    expect(rewriteLegacyPath('/b/nalla/create', '?look=abc')).toBe('/nalla/create?look=abc');
    expect(rewriteLegacyPath('/b/nalla/s/spring/n/8f3e', '?i=2')).toBe('/nalla/sets/spring/shots/8f3e?i=2');
  });

  it('takes an id where a slug belongs, for the resolvers to rewrite later', () => {
    expect(rewriteLegacyPath('/b/2b8f-uuid/s/9c1a-uuid')).toBe('/2b8f-uuid/sets/9c1a-uuid');
  });

  it('sends a prefix with no brand home rather than building a broken path', () => {
    expect(rewriteLegacyPath('/b')).toBe('/');
    expect(rewriteLegacyPath('/b/')).toBe('/');
  });

  it('passes an unrecognised tail through instead of swallowing it', () => {
    expect(rewriteLegacyPath('/b/nalla/something-new')).toBe('/nalla/something-new');
  });
});
