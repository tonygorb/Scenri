import { createHash } from 'node:crypto';
import { httpText, mapPool } from '../http/fetch.js';
import { absolutize, originOf } from '../url.js';
import { normalizeProduct } from '../normalize.js';
import { attr, loadHtml, textOf } from '../html.js';
import type { AdapterContext, CatalogAdapter, CatalogProduct, DetectResult, DiscoverResult } from '../types.js';

function stableKey(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

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
  return [...out];
}

function walkJsonLd(node: unknown, out: any[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const n of node) walkJsonLd(n, out);
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  const types = Array.isArray(type) ? type : type ? [type] : [];
  if (types.some((t) => String(t).toLowerCase() === 'product')) out.push(obj);
  if (obj['@graph']) walkJsonLd(obj['@graph'], out);
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') walkJsonLd(v, out);
  }
}

/** An `image` entry in schema.org JSON-LD: a URL, or an ImageObject carrying one. */
type JsonLdImage = string | { url?: string; contentUrl?: string };

export function extractJsonLdProducts(html: string, pageUrl: string): CatalogProduct[] {
  const root = loadHtml(html);
  const nodes: any[] = [];
  for (const el of root.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = el.innerHTML;
    if (!raw) continue;
    try {
      walkJsonLd(JSON.parse(raw), nodes);
    } catch {
      /* ignore broken blocks */
    }
  }

  return nodes.map((n) => {
    const offers = Array.isArray(n.offers) ? n.offers[0] : n.offers;
    // schema.org lets `image` be a bare URL, an ImageObject, or an array
    // mixing both. Typing this as string[] made the object branch dead code to
    // the compiler while it still ran at runtime.
    const images = ([] as JsonLdImage[])
      .concat(n.image ?? [])
      .flat()
      .map((img) => (typeof img === 'string' ? img : (img?.url ?? img?.contentUrl)))
      .filter(Boolean)
      .map((u, i) => ({ url: absolutize(pageUrl, String(u))!, position: i, width: null, height: null, alt: null }))
      .filter((img) => img.url);

    const url = String(n.url ?? n['@id'] ?? pageUrl);
    return normalizeProduct({
      externalKey: String(n.sku || n.productID || n.mpn || stableKey(url)),
      title: String(n.name ?? 'Product'),
      descriptionHtml: n.description ? String(n.description) : null,
      url: absolutize(pageUrl, url) ?? pageUrl,
      vendor: n.brand?.name ?? (typeof n.brand === 'string' ? n.brand : null),
      productType: n.category ? String(n.category) : null,
      category: n.category ? String(n.category) : null,
      price: offers?.price != null ? Number(offers.price) : null,
      compareAtPrice: null,
      currency: offers?.priceCurrency ?? null,
      available: offers?.availability ? /instock/i.test(String(offers.availability)) : null,
      tags: [],
      variants: [],
      images,
      raw: n,
    });
  });
}

export function parseProductHtml(html: string, pageUrl: string): CatalogProduct | null {
  const $ = loadHtml(html);
  const title =
    attr($.querySelector('meta[property="og:title"]'), 'content') ||
    textOf($.querySelector('h1')) ||
    textOf($.querySelector('title'));
  if (!title) return null;
  const desc =
    attr($.querySelector('meta[property="og:description"]'), 'content') ||
    attr($.querySelector('meta[name="description"]'), 'content') ||
    null;
  const images: { url: string; position: number; width: null; height: null; alt: string | null }[] = [];
  const og = attr($.querySelector('meta[property="og:image"]'), 'content');
  if (og) {
    const abs = absolutize(pageUrl, og);
    if (abs) images.push({ url: abs, position: 0, width: null, height: null, alt: null });
  }
  for (const el of $.querySelectorAll('img[src]')) {
    if (images.length >= 12) break;
    const src = attr(el, 'src') || attr(el, 'data-src');
    const abs = src ? absolutize(pageUrl, src) : null;
    if (!abs || /logo|icon|sprite|pixel|avatar/i.test(abs)) continue;
    if (images.some((x) => x.url === abs)) continue;
    images.push({ url: abs, position: images.length, width: null, height: null, alt: attr(el, 'alt') ?? null });
  }
  const canonical = attr($.querySelector('link[rel="canonical"]'), 'href');
  const url = canonical ? (absolutize(pageUrl, canonical) ?? pageUrl) : pageUrl;
  return normalizeProduct({
    externalKey: stableKey(url),
    title,
    descriptionHtml: desc,
    url,
    images,
    variants: [],
    tags: [],
    raw: { source: 'html' },
  });
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
    const out: CatalogProduct[] = [];
    const seen = new Set<string>();
    await mapPool(
      discovered.productUrls,
      5,
      async (u) => {
        try {
          const { ok, text, url } = await httpText(u, {
            fetchImpl: ctx.fetchImpl,
            signal: ctx.signal,
            accept: 'text/html',
          });
          if (!ok) return;
          const fromLd = extractJsonLdProducts(text, url);
          const list = fromLd.length ? fromLd : ([parseProductHtml(text, url)].filter(Boolean) as CatalogProduct[]);
          for (const p of list) {
            if (seen.has(p.externalKey)) continue;
            seen.add(p.externalKey);
            out.push(p);
          }
          ctx.onProgress?.({
            stage: 'fetching_products',
            fetched: out.length,
            discovered: discovered.productUrls.length,
          });
        } catch {
          /* skip */
        }
      },
      ctx.signal,
    );
    return out;
  },
};
