import { describe, expect, it } from 'vitest';
import { areasFor, parseMap } from '../scripts/docs-impact.mjs';

const map = `
# Docs impact

- Products: apps/studio/src/views/Product, packages/catalog
- Presenters: apps/studio/src/create/presenter
`;

describe('docs impact reminder', () => {
  it('reads area lines and ignores the rest', () => {
    expect(parseMap(map)).toEqual([
      { area: 'Products', prefixes: ['apps/studio/src/views/Product', 'packages/catalog'] },
      { area: 'Presenters', prefixes: ['apps/studio/src/create/presenter'] },
    ]);
  });

  it('names only the areas a path actually touches', () => {
    const hits = areasFor(['packages/catalog/src/detect.ts', 'packages/cli/test/foo.test.ts'], parseMap(map));
    expect(hits.map((h) => h.area)).toEqual(['Products']);
    expect(areasFor(['packages/cli/test/foo.test.ts'], parseMap(map))).toEqual([]);
  });
});
