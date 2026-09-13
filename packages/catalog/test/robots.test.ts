import { describe, it, expect } from 'vitest';
import { parseRobots, isAllowed, ALLOW_ALL } from '../src/robots.js';

/** gymshark.com's own rules, trimmed to the ones that decide our fetches. */
const GYMSHARK = `# we use Shopify as our ecommerce platform
User-agent: *
Disallow: /admin
Disallow: /cart
Disallow: /collections/*sort_by*
Disallow: /collections/*/products*
Disallow: /search
Sitemap: https://www.gymshark.com/sitemap.xml`;

describe('robots.txt', () => {
  const gym = parseRobots(GYMSHARK);

  it('allows the product pages a store offers', () => {
    expect(isAllowed(gym, 'https://www.gymshark.com/products/vital-shorts')).toBe(true);
    expect(isAllowed(gym, 'https://www.gymshark.com/sitemap_products_1.xml')).toBe(true);
  });

  it('refuses what the store asked us not to read', () => {
    expect(isAllowed(gym, 'https://www.gymshark.com/search?q=shorts')).toBe(false);
    expect(isAllowed(gym, 'https://www.gymshark.com/cart')).toBe(false);
    expect(isAllowed(gym, 'https://www.gymshark.com/collections/tops/products?page=2')).toBe(false);
  });

  it('lets a longer Allow carve an exception out of a Disallow', () => {
    const r = parseRobots('User-agent: *\nDisallow: /products\nAllow: /products/public');
    expect(isAllowed(r, 'https://x.example/products/secret')).toBe(false);
    expect(isAllowed(r, 'https://x.example/products/public/a')).toBe(true);
  });

  it('honours the group naming us over the catch-all', () => {
    const r = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: scenri-catalog\nDisallow: /private');
    expect(isAllowed(r, 'https://x.example/products/a')).toBe(true);
    expect(isAllowed(r, 'https://x.example/private/a')).toBe(false);
  });

  it('reads a crawl delay, in milliseconds', () => {
    expect(parseRobots('User-agent: *\nCrawl-delay: 2').crawlDelayMs).toBe(2000);
    expect(parseRobots('User-agent: *\nDisallow: /x').crawlDelayMs).toBe(0);
  });

  it('fails open on nothing, noise, or an empty file', () => {
    for (const text of ['', 'not a robots file at all', '#just a comment']) {
      expect(isAllowed(parseRobots(text), 'https://x.example/anything')).toBe(true);
    }
    expect(isAllowed(ALLOW_ALL, 'https://x.example/anything')).toBe(true);
  });

  it('treats $ as end of path', () => {
    const r = parseRobots('User-agent: *\nDisallow: /*.pdf$');
    expect(isAllowed(r, 'https://x.example/a/manual.pdf')).toBe(false);
    expect(isAllowed(r, 'https://x.example/a/manual.pdf.html')).toBe(true);
  });
});
