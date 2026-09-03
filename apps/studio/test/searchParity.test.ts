import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { matchesQuery } from '../src/layout/library/libraryRules.js';

/**
 * Two folds, one rule.
 *
 * The library pages search a catalog already in memory, so their rule is the
 * studio's own (`layout/library/libraryRules.ts`). The feed searches an index
 * on the server, so the same rule exists again in `packages/core`. The studio
 * has no dependency on `@scenri/core` — deliberately, the way the `markLabel`
 * pair is kept — so neither can import the other and the two can drift with
 * nothing to notice. Both files say they are kept in step; this is what makes
 * that true.
 *
 * The technique is the one `thumbUrl.test.ts` uses for its own contract: read
 * the sources and compare them. Not a substitute for behaviour — the cases
 * below run against the studio's copy — but it is what catches a change made
 * to one side alone.
 */

const here = fileURLToPath(import.meta.url);
const read = (p: string) => readFileSync(resolve(here, '..', '..', p), 'utf8');
const STUDIO = read('src/layout/library/libraryRules.ts');
const CORE = read('../../packages/core/src/searchRules.ts');

/** The chain of transforms a fold applies, stripped of comments and whitespace. */
const foldChain = (src: string): string[] =>
  (src.slice(src.indexOf('function fold(')).match(/\.\w+\([^)]*\)/g) ?? [])
    .slice(0, 4)
    .map((s) => s.replace(/\s+/g, ''));

describe('the two copies of the search rule', () => {
  it('fold the same way, transform for transform', () => {
    const studio = foldChain(STUDIO);
    const core = foldChain(CORE);
    expect(studio).toHaveLength(4);
    expect(core).toEqual(studio);
    // and the four are the ones the rule is documented as: decompose, drop
    // combining marks, drop invisible bidi controls, lowercase
    expect(studio[0]).toContain("normalize('NFD')");
    expect(studio[1]).toContain('Diacritic');
    expect(studio[2]).toContain('u200e');
    expect(studio[3]).toContain('toLowerCase');
  });

  it('agree on the plural floor', () => {
    const floorOf = (src: string) => /STEM_MIN = (\d+)/.exec(src)?.[1];
    expect(floorOf(STUDIO)).toBe('4');
    expect(floorOf(CORE)).toBe(floorOf(STUDIO));
  });

  /**
   * Where they part, on purpose. A term under three characters cannot be
   * answered by a trigram index, so the feed filters no text until the third
   * letter (`TRIGRAM_MIN` in core); the library pages, matching in memory,
   * still narrow from the first. This asserts the divergence is declared, so
   * that removing it is a deliberate act rather than a silent one.
   */
  it('declare where the server search deliberately differs', () => {
    expect(CORE).toContain('TRIGRAM_MIN = 3');
    expect(STUDIO).not.toContain('TRIGRAM_MIN');
  });
});

describe('what the shared rule matches', () => {
  const cases: ReadonlyArray<[string, string, boolean]> = [
    ['Ceramic Mug', 'mug', true],
    ['Ceramic Mugs', 'mug', true],
    ['Ceramic Mug', 'mugs', true],
    ['Ceramic Mug', 'plinth', false],
    // an accent is never the reason a thing cannot be found, either direction
    ['Soft ROSÉ linen', 'rose linen', true],
    ['Soft rose linen', 'rosé', true],
    // a short term keeps its s: dropping it from "as" leaves "a"
    ['a plinth', 'as', false],
    // every term has to land, in any order
    ['marble plinth studio', 'studio marble', true],
    ['marble plinth studio', 'marble velvet', false],
    ['anything at all', '   ', true],
    // bidi controls ride in from pasted RTL names and are not letters
    ['‎Ceramic‪ Mug', 'ceramic mug', true],
  ];
  for (const [haystack, query, want] of cases) {
    it(`${JSON.stringify(query)} ${want ? 'finds' : 'misses'} ${JSON.stringify(haystack)}`, () => {
      expect(matchesQuery(haystack, query)).toBe(want);
    });
  }
});
