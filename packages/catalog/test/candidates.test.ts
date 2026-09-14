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
  const seen = calls;
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
  return { fetchImpl, calls, seen };
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

/**
 * gymshark.com answers 301 to us.checkout.gymshark.com, a checkout host with
 * no catalog on it, while www.gymshark.com is the store. Following the
 * redirect is the obvious fix and the wrong one.
 */
describe('a bare domain that is not where the shop lives', () => {
  /** Products only under www; the apex knows nothing. */
  function splitHost() {
    const seen: string[] = [];
    const fetchImpl = (async (input: any) => {
      const url = String(input);
      seen.push(url);
      const onWww = url.includes('//www.');
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (/\/products\.json/.test(url)) return new Response('no', { status: 403 });
      if (url.endsWith('/sitemap.xml') && onWww)
        return new Response(
          `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://www.shop.example/sitemap_products_1.xml</loc></sitemap></sitemapindex>`,
          { status: 200 },
        );
      if (url.includes('sitemap_products') && onWww)
        return new Response(
          `<?xml version="1.0"?><urlset>${['a', 'b', 'c']
            .map((h) => `<url><loc>https://www.shop.example/products/${h}</loc></url>`)
            .join('')}</urlset>`,
          { status: 200 },
        );
      if (url.includes('sitemap')) return new Response('<urlset></urlset>', { status: 200 });
      const handle = /\/products\/([^/?#.]+)$/.exec(url)?.[1];
      if (handle && onWww)
        return new Response(
          `<html><head><script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            name: handle,
            url,
            offers: { price: 10, priceCurrency: 'USD' },
          })}</script></head></html>`,
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      return new Response('<html><body>nothing here</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }) as typeof fetch;
    return { fetchImpl, seen };
  }

  it('finds the shop that only answers under www', async () => {
    const { fetchImpl } = splitHost();
    const scan = await scanForCandidates({ url: 'shop.example', fetchImpl });
    expect(scan.verdict).toBe('found');
    expect(scan.baseUrl).toBe('https://www.shop.example');
    expect(scan.count).toBe(3);
  });

  it('does not pay for the second look when the first one found a shop', async () => {
    const { fetchImpl, seen } = storefront(10);
    await scanForCandidates({ url: 'https://shop.example', fetchImpl, budget: { maxPreviewPages: 2 } });
    expect(seen.filter((u) => u.includes('//www.'))).toHaveLength(0);
  });

  it('leaves a host that already names a subdomain alone', async () => {
    const { fetchImpl, seen } = splitHost();
    const scan = await scanForCandidates({ url: 'https://shop.acme.example', fetchImpl });
    expect(scan.verdict).toBe('none');
    expect(seen.filter((u) => u.includes('//www.'))).toHaveLength(0);
  });
});

/**
 * The apex redirects to a checkout host where discovery finds thousands of
 * addresses and can read none of them. That is `blocked`, not `none`, and
 * only retrying on `none` left it there.
 */
it('tries www after a blocked look, not only an empty one', async () => {
  const fetchImpl = (async (input: any) => {
    const url = String(input);
    const onWww = url.includes('//www.');
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    if (/\/products\.json/.test(url)) return new Response('no', { status: 403 });
    if (url.endsWith('/sitemap.xml'))
      return new Response(
        `<?xml version="1.0"?><sitemapindex><sitemap><loc>${
          onWww ? 'https://www.shop.example' : 'https://shop.example'
        }/sitemap_products_1.xml</loc></sitemap></sitemapindex>`,
        { status: 200 },
      );
    if (url.includes('sitemap_products')) {
      const host = onWww ? 'https://www.shop.example' : 'https://shop.example';
      return new Response(
        `<?xml version="1.0"?><urlset>${['a', 'b']
          .map((h) => `<url><loc>${host}/products/${h}</loc></url>`)
          .join('')}</urlset>`,
        { status: 200 },
      );
    }
    if (url.includes('sitemap')) return new Response('<urlset></urlset>', { status: 200 });
    const handle = /\/products\/([^/?#.]+)$/.exec(url)?.[1];
    if (handle) {
      // The apex lists products and then refuses to serve any of them.
      if (!onWww) return new Response('nope', { status: 403 });
      return new Response(
        `<html><head><script type="application/ld+json">${JSON.stringify({
          '@type': 'Product',
          name: handle,
          url,
          offers: { price: 10, priceCurrency: 'USD' },
        })}</script></head></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    }
    return new Response('<html><body>shop</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }) as typeof fetch;

  const scan = await scanForCandidates({ url: 'shop.example', fetchImpl });
  expect(scan.verdict).toBe('found');
  expect(scan.baseUrl).toBe('https://www.shop.example');
  expect(scan.candidates.length).toBeGreaterThan(0);
});
