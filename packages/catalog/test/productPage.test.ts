import { describe, it, expect } from 'vitest';
import { extractJsonLdProducts, productsFromPage } from '../src/adapters/productPage.js';

const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const page = (head: string, body = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

const GROUP = {
  '@context': 'https://schema.org',
  '@type': 'ProductGroup',
  name: 'Vital Shorts',
  url: 'https://shop.example/products/vital-shorts',
  brand: { '@type': 'Brand', name: 'Gym' },
  category: 'Shorts',
  image: ['https://cdn.example/vital.jpg'],
  productGroupID: 'pg-1',
  variesBy: ['https://schema.org/size'],
  // A real store reusing one sku across every size: measured on gymshark.com.
  hasVariant: ['xs', 's', 'm'].map((size) => ({
    '@type': 'Product',
    name: 'Vital Shorts',
    sku: 'B1A4J-EBDK',
    size,
    url: 'https://shop.example/products/vital-shorts',
    offers: { '@type': 'Offer', price: 40, priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
  })),
};

describe('a ProductGroup is one product', () => {
  it('folds hasVariant into variants rather than emitting siblings', () => {
    const got = extractJsonLdProducts(page(ld(GROUP)), 'https://shop.example/products/vital-shorts');
    expect(got).toHaveLength(1);
    expect(got[0].title).toBe('Vital Shorts');
    expect(got[0].variants).toHaveLength(3);
    expect(got[0].price).toBe(40);
    expect(got[0].currency).toBe('USD');
    expect(got[0].vendor).toBe('Gym');
  });

  it('tells variants apart even when the store reuses one sku', () => {
    const [p] = extractJsonLdProducts(page(ld(GROUP)), 'https://shop.example/products/vital-shorts');
    const keys = p.variants!.map((v) => v.externalKey);
    expect(new Set(keys).size).toBe(3);
    expect(keys).toContain('B1A4J-EBDK:xs');
    expect(p.variants!.map((v) => v.options?.size)).toEqual(['xs', 's', 'm']);
  });

  it('keeps a plain Product working beside the group', () => {
    const single = { '@type': 'Product', name: 'Cap', url: '/products/cap', offers: { price: '10' } };
    const got = extractJsonLdProducts(page(ld([GROUP, single])), 'https://shop.example/x');
    expect(got.map((p) => p.title).sort()).toEqual(['Cap', 'Vital Shorts']);
  });
});

/**
 * Two different claims, two different gates.
 *
 * A declared price is stronger evidence than an Add to cart button, and a
 * headless storefront renders the button in the browser where no fetch of
 * ours will ever see it. A title and a picture remain worth nothing.
 */
describe('what productsFromPage will accept', () => {
  it('takes a priced Product with no buy button anywhere', () => {
    const html = page(ld({ '@type': 'Product', name: 'Mug', url: '/p/mug', offers: { price: '12' } }));
    expect(productsFromPage(html, 'https://shop.example/p/mug')).toHaveLength(1);
  });

  it('refuses a Product mentioned without a price, a sku or a variant', () => {
    const html = page(ld({ '@type': 'Product', name: 'Mentioned in passing', image: 'https://x.example/a.jpg' }));
    expect(productsFromPage(html, 'https://blog.example/post')).toHaveLength(0);
  });

  it('still refuses a page that only has a title and a picture', () => {
    const html = page('<meta property="og:title" content="Why oats"><meta property="og:image" content="/o.jpg">');
    expect(productsFromPage(html, 'https://brand.example/story')).toHaveLength(0);
  });

  it('takes the markup path when a real buy button is present', () => {
    const html = page(
      '<meta property="og:title" content="Tee"><meta property="og:image" content="/tee.jpg">',
      '<button>Add to cart</button>',
    );
    expect(productsFromPage(html, 'https://shop.example/p/tee')).toHaveLength(1);
  });
});

describe('product pictures', () => {
  const gallery = `
    <img src="/media/shot-1.jpg"><img src="/media/shot-2.jpg">
    <img src="/_next/static/media/us.bc5e2f3b.svg"><img src="/_next/static/media/de.06a14dfa.svg">
    <img src="/assets/icons/cart.svg"><img src="/img/site-logo.png">`;

  it('drops a framework build asset, which is how the flags get in', () => {
    // gymshark.com serves its country picker as /_next/static/media/us.<hash>.svg:
    // nothing in that URL says "flag", so only the directory gives it away.
    const [p] = productsFromPage(
      page(ld({ '@type': 'Product', name: 'Tee', offers: { price: '9' } }), gallery),
      'https://shop.example/p/tee',
    );
    const urls = (p.images ?? []).map((i) => i.url).join(' ');
    expect(urls).not.toMatch(/_next\/static|icons\/cart|site-logo/);
    expect(urls).toMatch(/shot-1/);
  });

  it('gives a lone structured product the pictures the page shows', () => {
    const one = ld({ '@type': 'Product', name: 'Tee', offers: { price: '9' }, image: 'https://cdn.example/hero.jpg' });
    const [p] = productsFromPage(page(one, gallery), 'https://shop.example/p/tee');
    expect(p.images!.map((i) => i.url)).toContain('https://cdn.example/hero.jpg');
    expect(p.images!.length).toBeGreaterThan(1);
  });

  it('leaves a listing page alone, where the pictures belong to no one product', () => {
    const many = ld([
      { '@type': 'Product', name: 'A', url: '/p/a', offers: { price: '1' }, image: 'https://cdn.example/a.jpg' },
      { '@type': 'Product', name: 'B', url: '/p/b', offers: { price: '2' }, image: 'https://cdn.example/b.jpg' },
    ]);
    const got = productsFromPage(page(many, gallery), 'https://shop.example/collections/all');
    expect(got).toHaveLength(2);
    for (const p of got) expect(p.images).toHaveLength(1);
  });
});
