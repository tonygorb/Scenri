import { describe, it, expect } from 'vitest';
import { extractJsonLdProducts, parseProductHtml, genericAdapter } from '../src/adapters/generic.js';
import { woocommerceAdapter } from '../src/adapters/woocommerce.js';
import { webflowAdapter } from '../src/adapters/webflow.js';

describe('JSON-LD + HTML product parse', () => {
  it('extracts Product from JSON-LD', () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        name: 'Candle',
        url: '/products/candle',
        image: 'https://img.example/candle.jpg',
        offers: { price: '24.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
        brand: { name: 'Acme' },
      })}</script>
    </head></html>`;
    const products = extractJsonLdProducts(html, 'https://store.example/products/candle');
    expect(products).toHaveLength(1);
    expect(products[0].title).toBe('Candle');
    expect(products[0].price).toBe(24);
    expect(products[0].images![0].url).toContain('candle.jpg');
  });

  it('reads images given as ImageObject, as a bare url, and as a mix of both', () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        name: 'Lamp',
        url: '/products/lamp',
        image: [
          'https://img.example/lamp-1.jpg',
          { '@type': 'ImageObject', url: 'https://img.example/lamp-2.jpg' },
          { '@type': 'ImageObject', contentUrl: 'https://img.example/lamp-3.jpg' },
        ],
        offers: { price: '80.00', priceCurrency: 'USD' },
      })}</script>
    </head></html>`;
    const products = extractJsonLdProducts(html, 'https://store.example/products/lamp');
    expect(products).toHaveLength(1);
    expect(products[0].images!.map((i) => i.url)).toEqual([
      'https://img.example/lamp-1.jpg',
      'https://img.example/lamp-2.jpg',
      'https://img.example/lamp-3.jpg',
    ]);
  });

  it('drops an image object carrying neither url nor contentUrl', () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        name: 'Vase',
        url: '/products/vase',
        image: [{ '@type': 'ImageObject', caption: 'no url here' }, 'https://img.example/vase.jpg'],
      })}</script>
    </head></html>`;
    const products = extractJsonLdProducts(html, 'https://store.example/products/vase');
    expect(products[0].images!.map((i) => i.url)).toEqual(['https://img.example/vase.jpg']);
  });

  it('falls back to og tags', () => {
    const html = `<html><head>
      <meta property="og:title" content="Mug">
      <meta property="og:image" content="/mug.jpg">
      <link rel="canonical" href="https://store.example/product/mug">
    </head></html>`;
    const p = parseProductHtml(html, 'https://store.example/product/mug');
    expect(p?.title).toBe('Mug');
    expect(p?.images?.[0].url).toBe('https://store.example/mug.jpg');
  });
});

describe('woocommerce detect + store api', () => {
  it('paginates store API to exhaustion', async () => {
    const fetchImpl = (async (input: any) => {
      const url = String(input);
      if (url.includes('/wp-json/wc/store/v1/products')) {
        const page = Number(new URL(url).searchParams.get('page') ?? '1');
        if (page > 2) return new Response(JSON.stringify([]), { status: 200 });
        const batch = Array.from({ length: page === 2 ? 2 : 100 }, (_, i) => {
          const id = (page - 1) * 100 + i + 1;
          return {
            id,
            name: `Woo ${id}`,
            slug: `woo-${id}`,
            permalink: `https://woo.example/product/woo-${id}/`,
            description: 'd',
            prices: { price: '1000', regular_price: '1200', currency_code: 'USD', currency_minor_unit: 2 },
            images: [{ src: `https://woo.example/img/${id}.jpg` }],
            categories: [{ name: 'Home' }],
            tags: [],
            is_in_stock: true,
          };
        });
        return new Response(JSON.stringify(batch), { status: 200 });
      }
      if (url.includes('sitemap')) return new Response('<urlset></urlset>', { status: 200 });
      return new Response('<html></html>', { status: 200 });
    }) as typeof fetch;

    const det = await woocommerceAdapter.detect({ fetchImpl, baseUrl: 'https://woo.example' });
    expect(det?.platform).toBe('woocommerce');
    const disc = await woocommerceAdapter.discover({ fetchImpl, baseUrl: 'https://woo.example' });
    expect(disc.productKeys.length).toBe(102);
    const products = await woocommerceAdapter.fetchAll({ fetchImpl, baseUrl: 'https://woo.example' }, disc);
    expect(products.length).toBe(102);
    expect(products[0].price).toBe(10);
  });
});

describe('webflow detect', () => {
  it('detects webflow commerce signals', async () => {
    const fetchImpl = (async () =>
      new Response('<html><body class="w-commerce" data-wf-site="x">webflow</body></html>', {
        status: 200,
      })) as typeof fetch;
    const det = await webflowAdapter.detect({ fetchImpl, baseUrl: 'https://wf.example' });
    expect(det?.platform).toBe('webflow');
    expect(det!.confidence).toBeGreaterThan(0.5);
  });
});

describe('generic sitemap discovery', () => {
  it('reads product urls from sitemap index', async () => {
    const fetchImpl = (async (input: any) => {
      const url = String(input);
      if (url.endsWith('/sitemap.xml')) {
        return new Response(
          `<?xml version="1.0"?><sitemapindex>
          <sitemap><loc>https://g.example/product-sitemap.xml</loc></sitemap>
        </sitemapindex>`,
          { status: 200 },
        );
      }
      if (url.includes('product-sitemap')) {
        return new Response(
          `<?xml version="1.0"?><urlset>
          <url><loc>https://g.example/product/one</loc></url>
          <url><loc>https://g.example/product/two</loc></url>
        </urlset>`,
          { status: 200 },
        );
      }
      if (url.includes('/product/')) {
        const name = url.split('/').pop();
        return new Response(
          `<html><head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            name,
            url,
            image: `https://g.example/${name}.jpg`,
            offers: { price: '5', priceCurrency: 'USD' },
          })}</script></head></html>`,
          { status: 200 },
        );
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const disc = await genericAdapter.discover({ fetchImpl, baseUrl: 'https://g.example' });
    expect(disc.productUrls.length).toBe(2);
    const products = await genericAdapter.fetchAll({ fetchImpl, baseUrl: 'https://g.example' }, disc);
    expect(products.length).toBe(2);
  });
});
