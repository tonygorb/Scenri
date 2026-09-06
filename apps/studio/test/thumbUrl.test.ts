import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assetThumbUrl, imgUrl, thumbOf, thumbUrl } from '../src/apiUploads.js';

const HASH = 'a'.repeat(32);

describe('derivative URLs', () => {
  it('names the two widths and the original', () => {
    expect(thumbUrl(HASH, 'tile')).toBe(`/api/images/${HASH}/thumb?w=640`);
    expect(thumbUrl(HASH, 'micro')).toBe(`/api/images/${HASH}/thumb?w=160`);
    expect(assetThumbUrl(`asset:${HASH}`, 'tile')).toBe(thumbUrl(HASH, 'tile'));
    expect(assetThumbUrl('/curated/cup.png', 'tile')).toBeNull();
    expect(assetThumbUrl(undefined, 'micro')).toBeNull();
  });

  it('resizes a store URL in either shape and passes every other URL through', () => {
    expect(thumbOf(imgUrl(HASH), 'micro')).toBe(thumbUrl(HASH, 'micro'));
    expect(thumbOf(thumbUrl(HASH, 'micro'), 'tile')).toBe(thumbUrl(HASH, 'tile'));
    expect(thumbOf(thumbUrl(HASH, 'tile'), 'full')).toBe(imgUrl(HASH));
    expect(thumbOf('/catalog/scenes/linen.jpg', 'tile')).toBe('/catalog/scenes/linen.jpg');
    expect(thumbOf('blob:http://localhost/abc', 'micro')).toBe('blob:http://localhost/abc');
    expect(thumbOf(null, 'tile')).toBeNull();
    expect(thumbOf(undefined, 'tile')).toBeUndefined();
  });
});

/**
 * Which surface fetches which size is a contract, not a preference: the feed
 * and the cards read the tile derivative, the stage reads the pixels the
 * engine made. A refactor that quietly puts the original back on a grid is
 * the regression this pass was made to remove.
 */
describe('who reads which size', () => {
  // not `new URL(template, import.meta.url)`: Vite rewrites that shape as an asset import
  const here = fileURLToPath(import.meta.url);
  const src = (p: string) => readFileSync(resolve(here, '..', '..', 'src', p), 'utf8');
  it('the feed tile, the cards and the strips read derivatives', () => {
    expect(src('layout/canvas/Tile.tsx')).toMatch(/thumbUrl\(n\.images\[0\], 'tile'\)/);
    expect(src('layout/CatalogCard.tsx')).toMatch(/thumbOf\(previewUrl, 'tile'\)/);
    expect(src('layout/detail/LineageStrip.tsx')).toMatch(/thumbUrl\(n\.images\[0\], 'micro'\)/);
    expect(src('layout/Notifications.tsx')).toMatch(/thumbUrl\(task\.thumb, 'micro'\)/);
    expect(src('layout/AssetsPanel.tsx')).toMatch(/thumbUrl\(hash, 'micro'\)/);
  });
  it('the stage, compare and the clipboard read the original', () => {
    expect(src('layout/Stage.tsx')).toMatch(/src=\{imgUrl\(hash\)\}/);
    expect(src('layout/DetailOverlay.tsx')).toMatch(/fetch\(imgUrl\(hash\)\)/);
  });
});
