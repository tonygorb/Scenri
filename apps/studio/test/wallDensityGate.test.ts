import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every catalog grid reads its page's density.
 *
 * A `.sc-masonry` without `data-density` falls back to the bare auto-fill in
 * library.css, so on a wide screen it draws its own column count (seven under
 * a five-column wall) and its cards miss the wall's corners. That is how
 * Home's Presenters and Scenes shelves came to look pasted under the use-case
 * wall. The library pages pass the attribute to every grid and every
 * skeleton; this holds every grid in the studio to the same.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

/** Each opening tag carrying the grid class; an arrow's `=>` does not end a tag. */
function gridTags(source: string): string[] {
  return [...source.matchAll(/<div\b(?:=>|[^>])*?className="sc-masonry"(?:=>|[^>])*>/g)].map((m) => m[0]);
}

describe('every catalog grid reads its page density', () => {
  const tags = tsxFiles(SRC).flatMap((file) =>
    gridTags(readFileSync(file, 'utf8')).map((tag) => ({ file: relative(SRC, file), tag })),
  );

  it('finds the grids it guards', () => {
    // a scan that matched nothing would pass forever
    expect(tags.length).toBeGreaterThanOrEqual(10);
  });

  it('draws no grid without data-density', () => {
    const bare = tags
      .filter(({ tag }) => !/\sdata-density[\s>=]/.test(tag))
      .map(({ file, tag }) => `${file}: ${tag.replace(/\s+/g, ' ')}`);
    expect(bare).toEqual([]);
  });
});
