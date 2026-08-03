import { httpJson, httpText, mapPool } from '../http/fetch.js';
import { absolutize, originOf } from '../url.js';
import { normalizeProduct } from '../normalize.js';
import { attr, loadHtml } from '../html.js';
import { extractJsonLdProducts, extractSitemapUrls, parseProductHtml } from './generic.js';
import type { AdapterContext, CatalogAdapter, CatalogProduct, DetectResult, DiscoverResult } from '../types.js';

async function tryStoreApi(ctx: AdapterContext, page: number, perPage = 100): Promise<any[] | null> {
  const origin = originOf(ctx.baseUrl);
  const url = `${origin}/wp-json/wc/store/v1/products?per_page=${perPage}&page=${page}`;
  const { ok, json, status } = await httpJson<any[]>(url, { fetchImpl: ctx.fetchImpl, signal: ctx.signal, retries: 1 });
  if (status === 404) return null;
  if (!ok || !Array.isArray(json)) return null;
  return json;
}

function mapStoreApiProduct(base: string, p: any): CatalogProduct {
  const permalink = String(p.permalink ?? p.url ?? '');
  const url = permalink || absolutize(base, `/product/${p.slug}`) || originOf(base);
  const images = (p.images ?? []).map((img: any, i: number) => ({
    url: String(img.src ?? img.thumbnail ?? img),
    position: i,
    width: null,
    height: null,
    alt: img.alt ?? img.name ?? null,
  }));
  const price =
    p.prices?.price != null
      ? Number(p.prices.price) /
        (Number(p.prices.currency_minor_unit ?? 2) === 0 ? 1 : 10 ** Number(p.prices.currency_minor_unit ?? 2))
      : p.price != null
        ? Number(p.price)
        : null;
  const regular =
    p.prices?.regular_price != null
      ? Number(p.prices.regular_price) / 10 ** Number(p.prices.currency_minor_unit ?? 2)
      : null;
  return normalizeProduct({
    externalKey: String(p.id),
    title: String(p.name ?? p.slug ?? 'Product'),
    descriptionHtml: p.description ?? p.short_description ?? null,
    url,
    handle: p.slug ?? null,
    vendor: null,
    productType: p.categories?.[0]?.name ?? null,
    tags: (p.tags ?? []).map((t: any) => t.name ?? t).filter(Boolean),
    category: p.categories?.[0]?.name ?? null,
    price,
    compareAtPrice: regular && price != null && regular > price ? regular : null,
    currency: p.prices?.currency_code ?? null,
    available: p.is_in_stock ?? p.is_purchasable ?? null,
    variants: (p.variations ?? []).map((v: any) => ({
      externalKey: String(v.id ?? v),
      sku: v.sku ?? null,
      price: v.price != null ? Number(v.price) : null,
      available: v.is_in_stock ?? null,
      options: {},
    })),
    images,
    raw: p,
  });
}

export const woocommerceAdapter: CatalogAdapter = {
  platform: 'woocommerce',

  async detect(ctx): Promise<DetectResult | null> {
    const origin = originOf(ctx.baseUrl);
    const signals: string[] = [];
    const store = await tryStoreApi(ctx, 1, 1);
    if (store) {
      signals.push('wc-store-api');
      return { platform: 'woocommerce', confidence: 0.9, baseUrl: origin, signals };
    }
    const home = await httpText(origin, {
      fetchImpl: ctx.fetchImpl,
      signal: ctx.signal,
      retries: 1,
      accept: 'text/html',
    });
    if (home.ok) {
      if (/woocommerce|wp-content\/plugins\/woocommerce|wc-block/i.test(home.text)) {
        signals.push('woocommerce-html');
        return { platform: 'woocommerce', confidence: 0.65, baseUrl: origin, signals };
      }
    }
    return null;
  },

  async discover(ctx): Promise<DiscoverResult> {
    const warnings: string[] = [];
    const keys = new Set<string>();
    const productUrls = new Set<string>();

    let page = 1;
    let usedApi = false;
    while (true) {
      const batch = await tryStoreApi(ctx, page, 100);
      if (batch === null) break;
      usedApi = true;
      if (!batch.length) break;
      for (const p of batch) {
        keys.add(String(p.id));
        if (p.permalink) productUrls.add(String(p.permalink).split('?')[0]);
      }
      ctx.onProgress?.({ stage: 'discovering', discovered: keys.size, message: `Woo Store API page ${page}` });
      if (batch.length < 100) break;
      page++;
      if (page > 10_000) break;
    }

    try {
      const sitemapUrls = await extractSitemapUrls(
        ctx,
        (u) => /\/product\//i.test(u) || /[?&]p=\d+/i.test(u) || /\/products?\//i.test(u),
      );
      for (const u of sitemapUrls) productUrls.add(u);
      if (!usedApi && sitemapUrls.length) warnings.push('Using product sitemap (Store API unavailable)');
    } catch {
      warnings.push('Woo product sitemap could not be read');
    }

    return {
      productKeys: [...keys],
      productUrls: [...productUrls],
      estimatedTotal: keys.size || productUrls.size || null,
      warnings,
    };
  },

  async fetchAll(ctx, discovered): Promise<CatalogProduct[]> {
    const origin = originOf(ctx.baseUrl);
    const out: CatalogProduct[] = [];
    const seen = new Set<string>();

    let page = 1;
    let apiWorked = false;
    while (true) {
      const batch = await tryStoreApi(ctx, page, 100);
      if (batch === null) break;
      apiWorked = true;
      if (!batch.length) break;
      for (const p of batch) {
        const mapped = mapStoreApiProduct(origin, p);
        if (seen.has(mapped.externalKey)) continue;
        seen.add(mapped.externalKey);
        out.push(mapped);
      }
      ctx.onProgress?.({
        stage: 'fetching_products',
        fetched: out.length,
        discovered: discovered.estimatedTotal ?? out.length,
      });
      if (batch.length < 100) break;
      page++;
      if (page > 10_000) break;
    }

    if (apiWorked && out.length) return out;

    const urls = discovered.productUrls.length ? discovered.productUrls : [...new Set(discovered.productKeys)];
    await mapPool(
      urls,
      5,
      async (u) => {
        try {
          const {
            ok,
            text,
            url: finalUrl,
          } = await httpText(u, { fetchImpl: ctx.fetchImpl, signal: ctx.signal, accept: 'text/html' });
          if (!ok) return;
          const fromLd = extractJsonLdProducts(text, finalUrl);
          const products = fromLd.length
            ? fromLd
            : ([parseProductHtml(text, finalUrl)].filter(Boolean) as CatalogProduct[]);
          for (const p of products) {
            if (seen.has(p.externalKey)) continue;
            seen.add(p.externalKey);
            out.push(p);
          }
          ctx.onProgress?.({ stage: 'fetching_products', fetched: out.length });
        } catch {
          /* skip */
        }
      },
      ctx.signal,
    );

    return out;
  },
};

export async function discoverWooListingUrls(ctx: AdapterContext): Promise<string[]> {
  const origin = originOf(ctx.baseUrl);
  const found = new Set<string>();
  const seeds = [`${origin}/shop/`, `${origin}/shop`, `${origin}/products/`, origin];
  for (const seed of seeds) {
    const { ok, text, url } = await httpText(seed, {
      fetchImpl: ctx.fetchImpl,
      signal: ctx.signal,
      accept: 'text/html',
      retries: 1,
    });
    if (!ok) continue;
    const $ = loadHtml(text);
    for (const el of $.querySelectorAll('a[href*="/product/"]')) {
      const href = absolutize(url, attr(el, 'href') ?? '');
      if (href) found.add(href.split('?')[0]);
    }
  }
  return [...found];
}
