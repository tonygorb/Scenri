import { describe, it, expect } from 'vitest';
import { scanForCandidates } from '../src/candidates.js';

const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

const product = (handle: string) =>
  `<!doctype html><html><head>${ld({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: handle.replace(/-/g, ' '),
    url: `https://shop.example/products/${handle}`,
    image: `https://cdn.example/${handle}.jpg`,
    sku: handle.toUpperCase(),
    offers: { '@type': 'Offer', price: 25, priceCurrency: 'USD' },
  })}</head><body></body></html>`;

/** A store of `count` products, reachable only through its sitemap. */
function storefront(count: number, opts: { robots?: string; pdpStatus?: number; deadEveryOther?: boolean } = {}) {
  const handles = Array.from({ length: count }, (_, i) => `item-${i + 1}`);
  const calls: string[] = [];
  const fetchImpl = (async (input: any) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/robots.txt')) {
      return opts.robots ? new Response(opts.robots, { status: 200 }) : new Response('', { status: 404 });
    }
    if (/\/products\.json/.test(url) || /\/wp-json\//.test(url)) return new Response('no', { status: 403 });
    if (url.endsWith('/sitemap.xml')) {
      return new Response(
        `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://shop.example/sitemap_products_1.xml</loc></sitemap></sitemapindex>`,
        { status: 200 },
      );
    }
    if (url.includes('sitemap_products')) {
      return new Response(
        `<?xml version="1.0"?><urlset>${handles
          .map((h) => `<url><loc>https://shop.example/products/${h}</loc></url>`)
          .join('')}</urlset>`,
        { status: 200 },
      );
    }
    if (url.includes('sitemap')) return new Response('<urlset></urlset>', { status: 200 });
    const handle = /\/products\/([^/?#.]+)$/.exec(url)?.[1];
    if (handle) {
      if (opts.pdpStatus && opts.pdpStatus !== 200) return new Response('nope', { status: opts.pdpStatus });
      // Half the addresses are stubs that answer 200 and sell nothing.
      if (opts.deadEveryOther && Number(handle.split('-')[1]) % 2 === 0) {
        return new Response('<html><head><title>Redirecting</title></head><body></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response(product(handle), { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('<html><body>shop <script src="https://cdn.shopify.com/x.js"></script></body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('scanning a website for a shop', () => {
  it('counts the whole catalog but reads only a preview of it', async () => {
    const { fetchImpl, calls } = storefront(200);
    const scan = await scanForCandidates({ url: 'https://shop.example', fetchImpl, budget: { maxPreviewPages: 6 } });
    expect(scan.verdict).toBe('found');
    expect(scan.count).toBe(200);
    expect(scan.countSource).toBe('sitemap');
    expect(scan.candidates).toHaveLength(6);
    expect(scan.truncated).toBe(true);
    // The count is two sitemap requests; it must never cost 200 page reads.
    // Requests already in flight when the sixth product arrives still land,
    // so this is bounded rather than exact.
    const read = calls.filter((u) => /\/products\/item-/.test(u)).length;
    expect(read).toBeGreaterThanOrEqual(6);
    expect(read).toBeLessThanOrEqual(18);
  });

  it('hands back every discovered url, so importing need not discover again', async () => {
    const { fetchImpl } = storefront(30);
    const scan = await scanForCandidates({ url: 'https://shop.example', fetchImpl, budget: { maxPreviewPages: 4 } });
    expect(scan.candidateUrls).toHaveLength(30);
    expect(scan.candidates).toHaveLength(4);
  });

  it('says a marketing site has no shop, rather than failing', async () => {
    const fetchImpl = (async (input: any) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (url.includes('sitemap'))
        return new Response('<urlset><url><loc>https://b.example/about</loc></url></urlset>', { status: 200 });
      return new Response('<html><body><h1>We make oat drinks</h1></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }) as typeof fetch;
    const scan = await scanForCandidates({ url: 'https://b.example', fetchImpl });
    expect(scan.verdict).toBe('none');
    expect(scan.count).toBe(0);
    expect(scan.candidates).toHaveLength(0);
  });

  it('calls a store it can list but not read blocked, never empty', async () => {
    const { fetchImpl } = storefront(50, { pdpStatus: 403 });
    const scan = await scanForCandidates({ url: 'https://shop.example', fetchImpl, budget: { maxPreviewPages: 4 } });
    expect(scan.verdict).toBe('blocked');
    expect(scan.count).toBe(50);
    expect(scan.candidates).toHaveLength(0);
  });

  it('leaves alone what robots.txt disallows', async () => {
    const { fetchImpl, calls } = storefront(10, { robots: 'User-agent: *\nDisallow: /products/' });
    const scan = await scanForCandidates({ url: 'https://shop.example', fetchImpl });
    expect(calls.filter((u) => /\/products\/item-/.test(u))).toHaveLength(0);
    expect(scan.verdict).not.toBe('found');
    expect(scan.warnings.join(' ')).toMatch(/robots\.txt/);
  });

  /**
   * Discovery on a large store can run long. When it overran the whole budget
   * the preview read nothing and the store was reported as one we could not
   * open, from a site answering every request with a 200. Being slow to list a
   * catalog is not the same as being shut.
   */
  it('still previews when discovery has spent the whole budget', async () => {
    const { fetchImpl, calls } = storefront(40);
    const scan = await scanForCandidates({
      url: 'https://shop.example',
      fetchImpl,
      budget: { budgetMs: -1, maxPreviewPages: 4 },
    });
    expect(calls.filter((u) => /\/products\/item-/.test(u)).length).toBeGreaterThan(0);
    expect(scan.verdict).toBe('found');
    expect(scan.count).toBe(40);
  });

  it('stops for real when the floor is spent too', async () => {
    const { fetchImpl, calls } = storefront(40);
    const scan = await scanForCandidates({
      url: 'https://shop.example',
      fetchImpl,
      budget: { budgetMs: -1, previewFloorMs: -1 },
    });
    expect(calls.filter((u) => /\/products\/item-/.test(u))).toHaveLength(0);
    expect(scan.verdict).toBe('blocked');
    expect(scan.count).toBe(40);
  });

  it('reports what it spent, in pages rather than products', async () => {
    const { fetchImpl } = storefront(12);
    const scan = await scanForCandidates({ url: 'https://shop.example', fetchImpl, budget: { maxPreviewPages: 5 } });
    expect(scan.candidates).toHaveLength(5);
    // Requests already in flight when the target is met still cost something,
    // so pages read is at least the preview and never the whole catalog.
    expect(scan.spent.pages).toBeGreaterThanOrEqual(5);
    expect(scan.spent.pages).toBeLessThan(12);
    expect(scan.spent.bytes).toBeGreaterThan(0);
    expect(scan.spent.ms).toBeGreaterThanOrEqual(0);
  });

  /**
   * A sitemap is a list of addresses and some lead nowhere: oatly.com's bare
   * product URLs are 301 stubs, and six in a row yielded one product. Reading
   * exactly the first N addresses would show a preview of one card under a
   * count of 130.
   */
  it('keeps reading past the addresses that yield nothing', async () => {
    const { fetchImpl, calls } = storefront(60, { deadEveryOther: true });
    const scan = await scanForCandidates({ url: 'https://shop.example', fetchImpl, budget: { maxPreviewPages: 6 } });
    expect(scan.candidates).toHaveLength(6);
    const read = calls.filter((u) => /\/products\/item-/.test(u)).length;
    expect(read).toBeGreaterThan(6);
    // and still bounded: three addresses per product wanted, never the catalog
    expect(read).toBeLessThanOrEqual(18);
  });
});
