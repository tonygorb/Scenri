import { describe, it, expect } from 'vitest';
import { nameFromUrl, matches } from '../src/views/brandSetup/productNames.js';

describe('the name a product URL already carries', () => {
  it('reads a Shopify handle', () => {
    expect(nameFromUrl('https://www.gymshark.com/products/gymshark-vital-seamless-shorts-dark-green-marl-logo')).toBe(
      'Gymshark vital seamless shorts dark green marl logo',
    );
  });

  it('steps over a trailing id or a noise segment', () => {
    expect(nameFromUrl('https://shop.example/product/wool-overshirt/12345')).toBe('Wool overshirt');
    expect(nameFromUrl('https://shop.example/p/linen-trouser')).toBe('Linen trouser');
  });

  it('drops a page extension and decodes escapes', () => {
    expect(nameFromUrl('https://shop.example/products/caf%C3%A9-mug.html')).toBe('Café mug');
  });

  it('gives back the address when there is nothing to read', () => {
    expect(nameFromUrl('not a url at all')).toBe('Not a url at all');
  });
});

describe('searching those names', () => {
  const name = nameFromUrl('https://x.example/products/gymshark-vital-seamless-shorts-dark-green');

  it('ignores case and punctuation', () => {
    expect(matches(name, 'VITAL seamless')).toBe(true);
    expect(matches(name, 'vital-seamless')).toBe(true);
  });

  it('wants every word, in any order', () => {
    expect(matches(name, 'green shorts')).toBe(true);
    expect(matches(name, 'green trousers')).toBe(false);
  });

  it('matches everything on an empty search', () => {
    expect(matches(name, '')).toBe(true);
  });
});
