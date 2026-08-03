import { describe, it, expect } from 'vitest';
import { dedupeProducts, normalizeProduct } from '../src/normalize.js';
import { normalizeStoreUrl, upgradeImageUrl } from '../src/url.js';

describe('normalizeStoreUrl', () => {
  it('adds https and strips tracking', () => {
    expect(normalizeStoreUrl('acme.com?utm_source=x')).toBe('https://acme.com');
  });
  it('keeps product paths', () => {
    expect(normalizeStoreUrl('https://acme.com/products/bag')).toBe('https://acme.com/products/bag');
  });
});

describe('upgradeImageUrl', () => {
  it('strips shopify size suffixes', () => {
    expect(upgradeImageUrl('https://cdn.shopify.com/s/files/1/x/bag_200x200.jpg')).toBe(
      'https://cdn.shopify.com/s/files/1/x/bag.jpg',
    );
  });
});

describe('normalize + dedupe', () => {
  it('normalizes and dedupes by url and external key', () => {
    const a = normalizeProduct({
      externalKey: '1',
      title: '  Bag  ',
      url: 'https://acme.com/products/bag',
      images: [
        { url: 'https://cdn.shopify.com/s/files/1/x/bag_small.jpg', position: 0 },
        { url: 'https://cdn.shopify.com/s/files/1/x/bag_small.jpg', position: 1 },
      ],
      variants: [{ externalKey: 'v1', sku: 'BAG-1', price: 12 }],
    });
    expect(a.title).toBe('Bag');
    expect(a.images).toHaveLength(1);
    expect(a.images![0].url).toContain('bag.jpg');

    const dup = normalizeProduct({
      externalKey: '2',
      title: 'Bag Dup',
      url: 'https://acme.com/products/bag/',
      vendor: 'Acme',
      variants: [{ externalKey: 'v2', sku: 'BAG-1', price: 12 }],
      images: [{ url: 'https://cdn.shopify.com/s/files/1/x/bag2.jpg', position: 0 }],
    });
    // same SKU+vendor merges when first has vendor too
    const withVendor = { ...a, vendor: 'Acme' };
    const merged = dedupeProducts([withVendor, dup]);
    expect(merged).toHaveLength(1);
    expect(merged[0].images!.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps distinct products', () => {
    const list = dedupeProducts([
      { externalKey: '1', title: 'A', url: 'https://a.com/p/1', images: [] },
      { externalKey: '2', title: 'B', url: 'https://a.com/p/2', images: [] },
    ]);
    expect(list).toHaveLength(2);
  });
});
