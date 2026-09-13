import { httpText } from '../http/fetch.js';
import { absolutize, originOf, preferCanonicalLocale } from '../url.js';
import { attr, loadHtml } from '../html.js';
import { extractJsonLdProducts, fetchProductPages, stableKey } from './productPage.js';
import type { AdapterContext, CatalogAdapter, CatalogProduct, DetectResult, DiscoverResult } from '../types.js';

/**
 * Reading a single product page moved to `productPage.ts`, so Shopify could
 * use it too. These three keep their old home: WooCommerce, Webflow, the
 * package barrel and the tests all import them from here.
 */
export { extractJsonLdProducts, looksLikeProduct, parseProductHtml } from './productPage.js';

export async function extractSitemapUrls(
  ctx: AdapterContext,
  filter: (url: string) => boolean = () => true,
): Promise<string[]> {
  const origin = originOf(ctx.baseUrl);
  const out = new Set<string>();
  const queue = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/product-sitemap.xml`,
    `${origin}/sitemap_products_1.xml`,
  ];
  const seen = new Set<string>();

  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const { ok, text } = await httpText(next, {
      fetchImpl: ctx.fetchImpl,
      signal: ctx.signal,
      accept: 'application/xml,text/xml,*/*',
      retries: 1,
    });
    if (!ok) continue;
    const locs = [...text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
    for (const loc of locs) {
      if (/sitemap/i.test(loc)) {
        queue.push(loc);
        continue;
      }
      if (filter(loc)) out.add(loc.split('?')[0]);
    }
    if (seen.size > 200) break;
  }
  return preferCanonicalLocale([...out]);
}
async function extractFeedUrls(ctx: AdapterContext): Promise<string[]> {
  const origin = originOf(ctx.baseUrl);
  const candidates = [
    `${origin}/feeds/products.rss`,
    `${origin}/products.rss`,
    `${origin}/atom.xml`,
    `${origin}/feed`,
    `${origin}/collections/all.atom`,
  ];
  const urls = new Set<string>();
  for (const c of candidates) {
    const { ok, text } = await httpText(c, {
      fetchImpl: ctx.fetchImpl,
      signal: ctx.signal,
      retries: 0,
      accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*',
    });
    if (!ok) continue;
    for (const m of text.matchAll(/<link[^>]*>([^<]+)<\/link>|<link[^>]+href=["']([^"']+)["']/gi)) {
      const href = (m[1] || m[2] || '').trim();
      const abs = absolutize(c, href);
      if (abs && /product/i.test(abs)) urls.add(abs.split('?')[0]);
    }
    for (const m of text.matchAll(/<id>\s*([^<]+)\s*<\/id>/gi)) {
      const abs = absolutize(c, m[1].trim());
      if (abs && /product/i.test(abs)) urls.add(abs.split('?')[0]);
    }
  }
  return [...urls];
}

async function crawlListingPages(ctx: AdapterContext): Promise<string[]> {
  const origin = originOf(ctx.baseUrl);
  const found = new Set<string>();
  const visited = new Set<string>();
  const queue = [origin, `${origin}/collections/all`, `${origin}/shop`, `${origin}/products`, `${origin}/catalog`];

  while (queue.length && visited.size < 40) {
    const page = queue.shift()!;
    if (visited.has(page)) continue;
    visited.add(page);
    const { ok, text, url } = await httpText(page, {
      fetchImpl: ctx.fetchImpl,
      signal: ctx.signal,
      accept: 'text/html',
      retries: 1,
    });
    if (!ok) continue;

    for (const p of extractJsonLdProducts(text, url)) {
      found.add(p.url);
    }

    const $ = loadHtml(text);
    for (const el of $.querySelectorAll('a[href]')) {
      const href = absolutize(url, attr(el, 'href') ?? '');
      if (!href?.startsWith(origin)) continue;
      const path = new URL(href).pathname;
      if (/\/products?\/[^/]+/i.test(path) || /\/product\/[^/]+/i.test(path)) {
        found.add(href.split('?')[0]);
      } else if (
        /page=\d+/i.test(href) ||
        /\/page\/\d+/i.test(path) ||
        /\/collections\//i.test(path) ||
        /\/shop/i.test(path)
      ) {
        if (visited.size + queue.length < 40) queue.push(href.split('#')[0]);
      }
    }
  }
  return [...found];
}

export const genericAdapter: CatalogAdapter = {
  platform: 'generic',

  async detect(ctx): Promise<DetectResult | null> {
    return {
      platform: 'generic',
      confidence: 0.2,
      baseUrl: originOf(ctx.baseUrl),
      signals: ['fallback'],
    };
  },

  async discover(ctx): Promise<DiscoverResult> {
    const warnings: string[] = [];
    const productUrls = new Set<string>();

    try {
      const sitemap = await extractSitemapUrls(
        ctx,
        (u) => /\/products?\//i.test(u) || /\/product\//i.test(u) || /[?&]product/i.test(u),
      );
      for (const u of sitemap) productUrls.add(u);
      if (!sitemap.length) warnings.push('No product URLs found in sitemaps');
    } catch {
      warnings.push('Sitemap discovery failed');
    }

    try {
      for (const u of await extractFeedUrls(ctx)) productUrls.add(u);
    } catch {
      /* optional */
    }

    if (productUrls.size < 5) {
      try {
        for (const u of await crawlListingPages(ctx)) productUrls.add(u);
      } catch {
        warnings.push('Listing crawl failed');
      }
    }

    ctx.onProgress?.({ stage: 'discovering', discovered: productUrls.size });

    return {
      productKeys: [...productUrls].map(stableKey),
      productUrls: [...productUrls],
      estimatedTotal: productUrls.size || null,
      warnings,
    };
  },

  async fetchAll(ctx, discovered): Promise<CatalogProduct[]> {
    return fetchProductPages(ctx, discovered.productUrls, {
      onProduct: (fetched) =>
        ctx.onProgress?.({ stage: 'fetching_products', fetched, discovered: discovered.productUrls.length }),
    });
  },
};
