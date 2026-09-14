import { describe, expect, it } from 'vitest';
import { buildFromUrl } from '@scenri/brand';
import { inspectMark } from '../src/markShape.js';
import { toMarkPng } from '../src/routes/shared.js';

/**
 * Twelve real websites, opt-in, off by default.
 *
 * Fixtures prove the rules; only the open web proves the rules were the right
 * ones. Every scoring bug this module has had was found here and none of them
 * by a fixture: a circular team photo crowned as a logo, a page builder's
 * unused theme handed back as the palette, Tailwind's own default scale
 * out-counting a site's brand, a US flag from a region switcher, and a
 * white-on-dark mark that rasterised to nothing.
 *
 *   SCRAPE_LIVE=1 pnpm --filter @scenri/brand test
 *
 * It asserts shape, never particular colours or a particular file: those
 * belong to the sites and change without warning. What it holds these pages to
 * is the promise the product makes - a name, and never a confidently wrong
 * logo.
 */

const SITES = [
  ['portfolio, plain HTML', 'https://paulgraham.com'],
  ['portfolio', 'https://brittanychiang.com'],
  ['agency', 'https://pentagram.com'],
  ['SaaS', 'https://linear.app'],
  ['SaaS, dark', 'https://vercel.com'],
  ['SaaS, oklch palette', 'https://tailwindcss.com'],
  ['company', 'https://basecamp.com'],
  ['ecommerce, shopify', 'https://www.allbirds.com'],
  ['ecommerce', 'https://www.gymshark.com'],
  ['brand-led', 'https://www.oatly.com'],
  ['corporate', 'https://www.apple.com'],
  ['minimal HTML', 'https://news.ycombinator.com'],
] as const;

const live = process.env.SCRAPE_LIVE === '1';

describe.skipIf(!live)('real websites', () => {
  it.each(SITES)('%s: %s', { timeout: 60_000 }, async (_kind, url) => {
    const { brand, report } = await buildFromUrl(url, {
      createdWith: 'live-smoke',
      saveAsset: async () => 'asset:x',
      // The same implementation production uses, not a copy that can drift.
      inspectMark: (buf) => inspectMark(buf, toMarkPng),
    });

    // A name always. Falling back to the hostname is allowed; being empty is not.
    expect(report.name.value.trim()).not.toBe('');
    expect((brand.meta as { slug: string }).slug).not.toBe('');

    // The promise that matters: a mark is only called the logo when the
    // evidence supports it. Anything weaker is saved as an alternate and said
    // out loud, because a confidently wrong logo is worse than an empty one.
    if (report.logo.status === 'primary') {
      expect(report.logo.score ?? 0).toBeGreaterThanOrEqual(80);
    }
    if (report.logo.status === 'alternate') {
      expect(report.logo.note ?? '').not.toBe('');
    }

    // A palette is small or it is nothing; never a page's whole colour inventory.
    expect(report.colors.count).toBeLessThanOrEqual(6);
  });
});
