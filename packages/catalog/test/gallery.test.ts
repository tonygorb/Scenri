import { describe, it, expect } from 'vitest';
import { productsFromPage } from '../src/adapters/productPage.js';

/**
 * What a product page offers as pictures, and what of it is actually the
 * product.
 *
 * Measured 2026-09-16 on a real storefront: all twenty-five products imported
 * from it carried the header's `login-svg.svg` as picture two, and their first
 * two pictures were the same packshot offered once over http and once over
 * https. Three image slots per product, one real photograph in them - and the
 * vector resolved to a 404 because the image store serves raster only.
 */
const page = (body: string) =>
  `<html><head>
     <meta property="og:image" content="https://cdn.example/packshot.jpg">
     <script type="application/ld+json">${JSON.stringify({
       '@context': 'https://schema.org',
       '@type': 'Product',
       name: 'A Thing',
       sku: 'S-1',
       url: 'https://shop.example/products/a-thing',
       offers: { '@type': 'Offer', price: 10, priceCurrency: 'USD' },
     })}</script>
   </head><body>${body}<button>Add to cart</button></body></html>`;

const imagesOf = (body: string) => {
  const products = productsFromPage(page(body), 'https://shop.example/products/a-thing');
  return (products[0]?.images ?? []).map((i) => i.url);
};

describe('the pictures taken off a product page', () => {
  it('drops the shop furniture, whatever it is called', () => {
    const urls = imagesOf(`
      <img src="https://cdn.example/login-svg.svg" alt="Login" width="40" height="40">
      <img src="https://cdn.example/account.png" alt="Account">
      <img src="https://cdn.example/cart.png" alt="Cart">
      <img src="https://cdn.example/real-shot-2.jpg" alt="Side">
    `);
    expect(urls.join(' ')).not.toMatch(/login|account|cart/i);
    expect(urls.join(' ')).toContain('real-shot-2.jpg');
  });

  it('never keeps a vector, which the library cannot show', () => {
    // Saved as `.svg`, resolved as `.png`, answered 404: a product that looked
    // imported pointing at a file nothing could open.
    const urls = imagesOf('<img src="https://cdn.example/diagram.svg" alt="Size chart">');
    expect(urls.join(' ')).not.toMatch(/\.svg/i);
  });

  it('believes the page when it says a picture is tiny', () => {
    const urls = imagesOf(`
      <img src="https://cdn.example/thumb-a.jpg" width="22" height="22" alt="">
      <img src="https://cdn.example/big-a.jpg" width="1200" height="1200" alt="">
    `);
    expect(urls.join(' ')).not.toContain('thumb-a.jpg');
    expect(urls.join(' ')).toContain('big-a.jpg');
  });

  it('takes one picture once, however many schemes it is offered under', () => {
    const urls = imagesOf(`
      <img src="https://cdn.example/packshot.jpg" alt="Front">
      <img src="http://cdn.example/packshot.jpg" alt="Front again">
    `);
    expect(urls.filter((u) => u.includes('packshot.jpg')).length).toBe(1);
  });

  it('still keeps the real photographs', () => {
    const urls = imagesOf(`
      <img src="https://cdn.example/shot-front.jpg" alt="Front">
      <img src="https://cdn.example/shot-back.jpg" alt="Back">
    `);
    expect(urls.join(' ')).toContain('shot-front.jpg');
    expect(urls.join(' ')).toContain('shot-back.jpg');
  });
});
