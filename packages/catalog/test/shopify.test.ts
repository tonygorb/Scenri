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
