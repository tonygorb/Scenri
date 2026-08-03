/**
 * Opt-in live smoke against real public storefronts.
 * Run with: CATALOG_LIVE=1 pnpm --filter @scenri/catalog test
 *
 * Asserts we discover a non-trivial catalog and that fetched count is close
 * to the discovery estimate (hidden/draft SKUs may create small gaps).
 */
import { describe, it, expect } from 'vitest';
import { runCatalogIngestion } from '../src/pipeline.js';

const LIVE = process.env.CATALOG_LIVE === '1';

const STORES = [
  { name: 'shopify-allbirds', url: 'https://www.allbirds.com', platform: 'shopify', min: 20 },
  { name: 'shopify-gymshark', url: 'https://www.gymshark.com', platform: 'shopify', min: 50 },
];

(LIVE ? describe : describe.skip)('live catalog smoke', () => {
  for (const store of STORES) {
    it(`imports a full-ish catalog from ${store.name}`, async () => {
      const result = await runCatalogIngestion({ url: store.url });
      expect(result.detection.platform).toBe(store.platform);
      expect(result.products.length).toBeGreaterThanOrEqual(store.min);
      if (result.progress.discovered > 0) {
        // Allow some gap for unpublished / region-gated items, but not a sample-sized scrape
        expect(result.products.length).toBeGreaterThanOrEqual(Math.floor(result.progress.discovered * 0.7));
      }
      const withImages = result.products.filter((p) => (p.images?.length ?? 0) > 0);
      expect(withImages.length).toBeGreaterThan(result.products.length * 0.5);
    }, 180_000);
  }
});
