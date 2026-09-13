import { describe, it, expect } from 'vitest';
import { shopifyAdapter } from '../src/adapters/shopify.js';
import { runCatalogIngestion } from '../src/pipeline.js';

function productsPage(page: number, totalPages: number, pageSize = 250, lastPageCount = 3) {
  if (page > totalPages) return { products: [] };
  const start = (page - 1) * pageSize;
  const count = page === totalPages ? lastPageCount : pageSize;
  return {
    products: Array.from({ length: count }, (_, i) => {
      const id = start + i + 1;
      return {
        id,
        title: `Product ${id}`,
        handle: `product-${id}`,
        body_html: `<p>Desc ${id}</p>`,
        vendor: 'Acme',
        product_type: 'Goods',
        tags: 'a, b',
        variants: [{ id: id * 10, title: 'Default', sku: `SKU-${id}`, price: '19.00', available: true }],
        images: [
          { src: `https://cdn.shopify.com/s/files/1/x/p${id}_200x200.jpg`, position: 1, width: 200, height: 200 },
        ],
      };
    }),
  };
}

describe('shopify adapter', () => {
  it('detects products.json and paginates past one page', async () => {
    const totalPages = 3; // 250+250+3 = 503 products
    const fetchImpl = (async (input: any) => {
      const url = String(input);
      if (url.includes('/products.json')) {
        const page = Number(new URL(url).searchParams.get('page') ?? '1');
        return new Response(JSON.stringify(productsPage(page, totalPages)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('sitemap')) {
        return new Response('<urlset></urlset>', { status: 200 });
      }
      return new Response('nope', { status: 404 });
    }) as typeof fetch;

    const detection = await shopifyAdapter.detect({ fetchImpl, baseUrl: 'https://shop.example' });
    expect(detection?.platform).toBe('shopify');

    const discovered = await shopifyAdapter.discover({ fetchImpl, baseUrl: 'https://shop.example' });
    expect(discovered.productKeys.length).toBe(503);

    const products = await shopifyAdapter.fetchAll({ fetchImpl, baseUrl: 'https://shop.example' }, discovered);
    expect(products.length).toBe(503);
    expect(products[0].images![0].url).not.toMatch(/_200x200/);
  });

  it('runCatalogIngestion returns all shopify products', async () => {
    const fetchImpl = (async (input: any) => {
      const url = String(input);
      if (url.includes('/products.json')) {
        const page = Number(new URL(url).searchParams.get('page') ?? '1');
        return new Response(JSON.stringify(productsPage(page, 1, 2, 2)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('sitemap')) return new Response('<urlset></urlset>', { status: 200 });
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const result = await runCatalogIngestion({ url: 'https://shop.example', fetchImpl });
    expect(result.detection.platform).toBe('shopify');
    expect(result.products).toHaveLength(2);
    expect(result.products[0].title).toMatch(/Product/);
  });
});

/**
 * gymshark.com, reproduced.
 *
 * Measured live 2026-09-13: it is a Shopify store behind a headless Next.js
 * storefront, and its CDN answers 403 to `/products.json` and to every
 * `/products/<handle>.json`, while serving the product pages themselves 200
 * with a complete `ProductGroup` block in `application/ld+json`.
 *
 * The adapter only ever asked for the two JSON endpoints, so a store with
 * 2202 readable product pages imported nothing at all, and the run ended as
 * `no_products_fetched` - a red bell on a shop that was never unreadable.
 */
describe('a shopify store whose json endpoints are blocked', () => {
  const HANDLES = ['vital-shorts-green', 'vital-shorts-black', 'training-tee-blue'];

  const productGroup = (handle: string) => ({
    '@context': 'https://schema.org',
    '@type': 'ProductGroup',
    name: handle.replace(/-/g, ' '),
    url: `https://gym.example/products/${handle}`,
    brand: { '@type': 'Brand', name: 'Gym' },
    category: 'Shorts',
    image: [`https://cdn.shopify.com/s/files/1/x/${handle}.jpg`],
    productGroupID: `pg-${handle}`,
    variesBy: ['https://schema.org/size'],
    hasVariant: ['xs', 's', 'm'].map((size) => ({
      '@type': 'Product',
      name: handle.replace(/-/g, ' '),
      sku: `${handle}-${size}`.toUpperCase(),
      size,
      url: `https://gym.example/products/${handle}`,
      image: `https://cdn.shopify.com/s/files/1/x/${handle}.jpg`,
      offers: {
        '@type': 'Offer',
        price: 40,
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
      },
    })),
  });

  const pdp = (handle: string) =>
    `<!doctype html><html><head>
      <meta property="og:title" content="${handle}">
      <meta property="og:type" content="website">
      <script type="application/ld+json">${JSON.stringify(productGroup(handle))}</script>
    </head><body>
      <button type="button" data-testid="pdp-addToBag-submit"><p>Add to bag</p></button>
    </body></html>`;

  /** Every request the adapter makes, so a blocked endpoint is not asked 2202 times. */
  function site() {
    const calls: string[] = [];
    const fetchImpl = (async (input: any) => {
      const url = String(input);
      calls.push(url);
      // The CDN refuses the storefront JSON, exactly as gymshark's does.
      if (/\/products\.json/.test(url) || /\/products\/[^/]+\.json/.test(url)) {
        return new Response('<html>403</html>', { status: 403, headers: { 'content-type': 'text/html' } });
      }
      if (url.endsWith('/sitemap.xml')) {
        return new Response(
          `<?xml version="1.0"?><sitemapindex>
            <sitemap><loc>https://gym.example/sitemap_products_1.xml</loc></sitemap>
          </sitemapindex>`,
          { status: 200 },
        );
      }
      if (url.includes('sitemap_products')) {
        return new Response(
          `<?xml version="1.0"?><urlset>${HANDLES.map(
            (h) => `<url><loc>https://gym.example/products/${h}</loc></url>`,
          ).join('')}</urlset>`,
          { status: 200 },
        );
      }
      const handle = /\/products\/([^/?#.]+)$/.exec(url)?.[1];
      if (handle) return new Response(pdp(handle), { status: 200, headers: { 'content-type': 'text/html' } });
      // The homepage carries the CDN hint that makes detection say shopify.
      return new Response('<html><body>built with <script src="https://cdn.shopify.com/x.js"></script></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  it('is still detected as shopify, from the homepage', async () => {
    const { fetchImpl } = site();
    const det = await shopifyAdapter.detect({ fetchImpl, baseUrl: 'https://gym.example' });
    expect(det?.platform).toBe('shopify');
    expect(det?.signals).toContain('shopify-html');
  });

  it('reads the product pages the json endpoints refused', async () => {
    const { fetchImpl } = site();
    const ctx = { fetchImpl, baseUrl: 'https://gym.example' };
    const discovered = await shopifyAdapter.discover(ctx);
    expect(discovered.productUrls).toHaveLength(HANDLES.length);

    const products = await shopifyAdapter.fetchAll(ctx, discovered);
    expect(products).toHaveLength(HANDLES.length);
    expect(products.map((p) => p.title).join(' ')).toMatch(/vital shorts green/i);
    expect(products[0].images?.[0].url).toMatch(/cdn\.shopify\.com/);
  });

  it('folds a ProductGroup into one product carrying its variants', async () => {
    const { fetchImpl } = site();
    const ctx = { fetchImpl, baseUrl: 'https://gym.example' };
    const products = await shopifyAdapter.fetchAll(ctx, await shopifyAdapter.discover(ctx));
    const one = products.find((p) => /green/.test(p.url ?? ''));
    expect(one).toBeDefined();
    // Three sizes are three variants of one product, never three products.
    expect(one!.variants).toHaveLength(3);
    expect(one!.variants!.map((v) => v.sku)).toContain('VITAL-SHORTS-GREEN-XS');
    expect(one!.price).toBe(40);
  });

  it('does not ask a refused endpoint once per product', async () => {
    const { fetchImpl, calls } = site();
    const ctx = { fetchImpl, baseUrl: 'https://gym.example' };
    await shopifyAdapter.fetchAll(ctx, await shopifyAdapter.discover(ctx));
    const handleJson = calls.filter((u) => /\/products\/[^/]+\.json/.test(u));
    expect(handleJson).toHaveLength(0);
  });

  it('reports products rather than no_products_fetched', async () => {
    const { fetchImpl } = site();
    const result = await runCatalogIngestion({ url: 'https://gym.example', fetchImpl });
    expect(result.detection.platform).toBe('shopify');
    expect(result.products).toHaveLength(HANDLES.length);
    expect(result.progress.errors.map((e) => e.code)).not.toContain('no_products_fetched');
  });
});
