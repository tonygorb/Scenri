import { httpJson, httpText, mapPool } from '../http/fetch.js';
import { absolutize, originOf, preferCanonicalLocale } from '../url.js';
import { normalizeProduct } from '../normalize.js';
import { fetchProductPages } from './productPage.js';
import type { AdapterContext, CatalogAdapter, CatalogProduct, DetectResult, DiscoverResult } from '../types.js';

function mapShopifyProduct(base: string, p: any): CatalogProduct {
  const handle = String(p.handle ?? '');
  const url = absolutize(base, `/products/${handle}`) ?? `${originOf(base)}/products/${handle}`;
  const variants = (p.variants ?? []).map((v: any) => ({
    externalKey: String(v.id ?? `${p.id}:${v.sku ?? v.title}`),
    title: v.title,
    sku: v.sku || null,
    price: v.price != null ? Number(v.price) : null,
    compareAtPrice: v.compare_at_price != null ? Number(v.compare_at_price) : null,
    currency: null,
    available: v.available ?? null,
    options: Object.fromEntries(
      ['option1', 'option2', 'option3']
        .map((k, i) => [p.options?.[i]?.name ?? `option${i + 1}`, v[k]])
        .filter(([, val]) => val != null && val !== ''),
    ),
  }));
  const images = (p.images ?? []).map((img: any, i: number) => ({
    url: String(img.src ?? img),
    position: img.position ?? i,
    width: img.width ?? null,
    height: img.height ?? null,
    alt: img.alt ?? null,
  }));
  // featured image fallback
  if (!images.length && p.image?.src) {
    images.push({
      url: String(p.image.src),
      position: 0,
      width: p.image.width ?? null,
      height: p.image.height ?? null,
      alt: p.image.alt ?? null,
    });
  }
  return normalizeProduct({
    externalKey: String(p.id),
    title: String(p.title ?? handle),
    descriptionHtml: p.body_html ?? null,
    url,
    handle,
    vendor: p.vendor ?? null,
    productType: p.product_type ?? null,
    tags:
      typeof p.tags === 'string'
        ? p.tags
            .split(',')
            .map((t: string) => t.trim())
            .filter(Boolean)
        : (p.tags ?? []),
    price: variants[0]?.price ?? null,
    compareAtPrice: variants[0]?.compareAtPrice ?? null,
    available: variants.some((v: any) => v.available) || null,
    variants,
    images,
    raw: p,
  });
}

/**
 * One page of the storefront product API.
 *
 * `blocked` separates "this store has no more products" from "this store will
 * not serve us its API", which are the same empty array and very different
 * facts. gymshark.com answers 403 here and 200 on every product page.
 */
async function fetchProductsJsonPage(
  ctx: AdapterContext,
  page: number,
  limit = 250,
): Promise<{ products: any[]; blocked: boolean }> {
  const origin = originOf(ctx.baseUrl);
  const url = `${origin}/products.json?limit=${limit}&page=${page}`;
  const { ok, status, json } = await httpJson<{ products?: any[] }>(url, {
    fetchImpl: ctx.fetchImpl,
    signal: ctx.signal,
  });
  if (ok && json?.products) return { products: json.products, blocked: false };
  return { products: [], blocked: status === 401 || status === 403 || status === 404 || status >= 500 };
}

/** Discovery's word that the product API refused us, so fetching must not ask it again. */
const JSON_BLOCKED = 'json-blocked';

async function collectSitemapProductUrls(ctx: AdapterContext): Promise<string[]> {
  const origin = originOf(ctx.baseUrl);
  const urls = new Set<string>();
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_products_1.xml`];
  const queue = [...candidates];
  const seen = new Set<string>();

  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const { ok, text } = await httpText(next, {
      fetchImpl: ctx.fetchImpl,
      signal: ctx.signal,
      accept: 'application/xml,text/xml,*/*',
    });
    if (!ok) continue;
    // nested sitemaps
    for (const m of text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
      const loc = m[1].trim();
      if (/sitemap.*products/i.test(loc) || /sitemap_products/i.test(loc)) {
        queue.push(loc);
      } else if (/\/products\//i.test(loc)) {
        urls.add(loc.split('?')[0]);
      }
    }
  }
  return preferCanonicalLocale([...urls]);
}

export const shopifyAdapter: CatalogAdapter = {
  platform: 'shopify',

  async detect(ctx): Promise<DetectResult | null> {
    const origin = originOf(ctx.baseUrl);
    const signals: string[] = [];
    const page1 = await httpJson<{ products?: any[] }>(`${origin}/products.json?limit=1`, {
      fetchImpl: ctx.fetchImpl,
      signal: ctx.signal,
      retries: 1,
    });
    if (page1.ok && Array.isArray(page1.json?.products)) {
      signals.push('products.json');
      return { platform: 'shopify', confidence: 0.95, baseUrl: origin, signals };
    }
    // CDN / chrome hints on homepage
    const home = await httpText(origin, {
      fetchImpl: ctx.fetchImpl,
      signal: ctx.signal,
      retries: 1,
      accept: 'text/html',
    });
    if (home.ok) {
      if (
        /cdn\.shopify\.com/i.test(home.text) ||
        /Shopify\.theme/i.test(home.text) ||
        /shopify-section/i.test(home.text)
      ) {
        signals.push('shopify-html');
        return { platform: 'shopify', confidence: 0.7, baseUrl: origin, signals };
      }
    }
    return null;
  },

  async discover(ctx): Promise<DiscoverResult> {
    const warnings: string[] = [];
    const hints: string[] = [];
    const keys = new Set<string>();
    const productUrls = new Set<string>();
    const origin = originOf(ctx.baseUrl);

    // Paginate products.json until empty — no artificial cap
    let page = 1;
    let emptyStreak = 0;
    while (emptyStreak < 1) {
      if (ctx.signal?.aborted) throw new Error('aborted');
      const { products, blocked } = await fetchProductsJsonPage(ctx, page);
      ctx.onProgress?.({ stage: 'discovering', discovered: keys.size, message: `Shopify page ${page}` });
      if (blocked && page === 1) {
        hints.push(JSON_BLOCKED);
        warnings.push('This store does not serve its product API, so the product pages were read instead');
      }
      if (!products.length) {
        emptyStreak++;
        break;
      }
      for (const p of products) {
        keys.add(String(p.id));
        if (p.handle) productUrls.add(`${origin}/products/${p.handle}`);
      }
      // Shopify caps at 250/page; if short page, we're done
      if (products.length < 250) break;
      page++;
      // safety against infinite weirdness
      if (page > 10_000) {
        warnings.push('Stopped pagination after 10,000 pages');
        break;
      }
    }

    // Augment with sitemap for any products products.json missed
    try {
      const sitemapUrls = await collectSitemapProductUrls(ctx);
      for (const u of sitemapUrls) productUrls.add(u);
      if (sitemapUrls.length > keys.size) {
        warnings.push(`Sitemap listed ${sitemapUrls.length} product URLs; products.json yielded ${keys.size} ids`);
      }
    } catch {
      warnings.push('Product sitemap could not be read');
    }

    return {
      productKeys: [...keys],
      productUrls: [...productUrls],
      estimatedTotal: keys.size || productUrls.size || null,
      warnings,
      hints,
    };
  },

  async fetchAll(ctx, discovered): Promise<CatalogProduct[]> {
    const origin = originOf(ctx.baseUrl);
    const out: CatalogProduct[] = [];
    const seen = new Set<string>();
    const jsonBlocked = discovered.hints?.includes(JSON_BLOCKED) ?? false;

    // Primary: walk products.json pages again for full payloads. Skipped
    // outright when discovery already found the API refuses us, because the
    // per-handle backfill below would then be one wasted request per product.
    let page = 1;
    while (!jsonBlocked) {
      if (ctx.signal?.aborted) throw new Error('aborted');
      const { products } = await fetchProductsJsonPage(ctx, page);
      if (!products.length) break;
      for (const p of products) {
        const mapped = mapShopifyProduct(origin, p);
        if (seen.has(mapped.externalKey)) continue;
        seen.add(mapped.externalKey);
        out.push(mapped);
      }
      ctx.onProgress?.({
        stage: 'fetching_products',
        fetched: out.length,
        discovered: discovered.estimatedTotal ?? out.length,
      });
      if (products.length < 250) break;
      page++;
      if (page > 10_000) break;
    }

    const handleOf = (u: string) => {
      const raw = /\/products\/([^/?#]+)/i.exec(u)?.[1];
      return raw ? decodeURIComponent(raw) : null;
    };
    const stillMissing = () =>
      discovered.productUrls.filter((u) => {
        const handle = handleOf(u);
        return handle && !out.some((p) => p.handle === handle);
      });

    // Second: the per-product API, for handles the listing did not carry.
    if (!jsonBlocked) {
      const missingUrls = stillMissing();
      if (missingUrls.length) {
        await mapPool(
          missingUrls,
          6,
          async (u) => {
            const handle = handleOf(u);
            if (!handle) return;
            const { ok, json } = await httpJson<{ product?: any }>(`${origin}/products/${handle}.json`, {
              fetchImpl: ctx.fetchImpl,
              signal: ctx.signal,
            });
            if (ok && json?.product) {
              const mapped = mapShopifyProduct(origin, json.product);
              if (!seen.has(mapped.externalKey)) {
                seen.add(mapped.externalKey);
                out.push(mapped);
                ctx.onProgress?.({ stage: 'fetching_products', fetched: out.length });
              }
            }
          },
          ctx.signal,
        );
      }
    }

    // Last: the product pages themselves, which a headless storefront serves
    // freely even when its JSON is refused. This is what turns gymshark.com
    // from an empty catalog into a readable one.
    const unread = stillMissing();
    if (unread.length) {
      for (const p of await fetchProductPages(ctx, unread, {
        concurrency: 4,
        onProduct: (fetched) => ctx.onProgress?.({ stage: 'fetching_products', fetched: out.length + fetched }),
      })) {
        if (seen.has(p.externalKey)) continue;
        seen.add(p.externalKey);
        out.push(p);
      }
    }

    return out;
  },
};
