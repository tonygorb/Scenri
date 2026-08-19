import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * The mark exists twice on purpose: as artwork in brand/, and inlined in the
 * component so it never arrives after the bar it sits in. This is the guard
 * that keeps the two the same drawing.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const paths = (svg: string) => [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
const inlined = (tsx: string, name: string) => {
  const block = tsx.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))?.[1] ?? '';
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

const symbol = paths(read('../brand/scenri-symbol.svg'));
const lockup = paths(read('../brand/scenri-lockup.svg'));
const tsx = read('../src/layout/ScenriMark.tsx');

describe('ScenriMark', () => {
  it('inlines the symbol artwork unchanged', () => {
    expect(symbol).toHaveLength(4);
    expect(inlined(tsx, 'SYMBOL')).toEqual(symbol);
  });

  it('inlines the wordmark artwork unchanged', () => {
    expect(inlined(tsx, 'WORDMARK')).toEqual(lockup.slice(4));
  });

  it('draws the lockup as the symbol followed by the wordmark', () => {
    expect(lockup.slice(0, 4)).toEqual(symbol);
    expect(lockup).toHaveLength(11);
  });

  it('keeps both files on currentColor, so the theme picks the ink', () => {
    for (const svg of ['../brand/scenri-symbol.svg', '../brand/scenri-lockup.svg']) {
      expect(read(svg)).toContain('fill="currentColor"');
      expect(read(svg)).not.toMatch(/fill="(#|white|black|rgb)/i);
    }
    expect(tsx).not.toMatch(/fill="(#|white|black)/i);
  });
});
