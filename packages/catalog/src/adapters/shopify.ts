import { httpJson, httpText, mapPool, outOfTime } from '../http/fetch.js';
import { absolutize, cardImageUrl, originOf, preferCanonicalLocale, upgradeImageUrl } from '../url.js';
import { normalizeProduct } from '../normalize.js';
import { fetchProductPages } from './productPage.js';
import type {
  AdapterContext,
  CatalogAdapter,
  CatalogCard,
  CatalogProduct,
  DetectResult,
  DiscoverResult,
} from '../types.js';

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

/**
 * The listing entry, as a card: a name, an address and one picture.
 *
 * The picture is asked for at card size, not at the size the importer wants.
 * `products.json` hands over the originals - 4.2 MB and 12.9 MB on a real
 * storefront - and a grid of two dozen of those is a hundred megabytes decoded
 * on the main thread, which is a window that has stopped responding. What gets
 * saved at import time is still the full-resolution one.
 */
function cardOf(origin: string, p: any): CatalogCard {
  const handle = String(p.handle ?? '');
  const first = (p.images ?? [])[0] ?? p.image ?? null;
  const src = first ? String(first.src ?? first) : null;
  return {
    externalKey: String(p.id),
    title: String(p.title ?? handle),
    url: absolutize(origin, `/products/${handle}`) ?? `${originOf(origin)}/products/${handle}`,
    handle: handle || null,
    image: src ? cardImageUrl(upgradeImageUrl(src)) : null,
  };
}

/** Discovery's word that the product API refused us, so fetching must not ask it again. */
const JSON_BLOCKED = 'json-blocked';

/**
 * Refusals from the per-product API before we stop asking it at all.
 *
 * `JSON_BLOCKED` covers a store that refuses `/products.json` outright, which
 * is the case discovery can see. A store can serve that bulk endpoint happily
 * and still guard the per-handle one, and that gap is what emptied a 1,186
 * product catalogue: the backfill asked for every missing handle, each answer
 * armed a host-wide cooldown, and the product pages that would have worked
 * waited behind it. Three consecutive refusals is a pattern, not bad luck, and
 * a challenge needs no second opinion at all.
 */
const JSON_GIVE_UP = 3;

/** Sitemap documents one store's index may send us to before we stop following. */
const MAX_SITEMAPS = 40;

async function collectSitemapProductUrls(ctx: AdapterContext): Promise<string[]> {
  const origin = originOf(ctx.baseUrl);
  const urls = new Set<string>();
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_products_1.xml`];
  const queue = [...candidates];
  const seen = new Set<string>();

  // A sitemap index can name hundreds of children, and this walked all of them
  // one at a time with nothing watching the clock.
  while (queue.length && seen.size < MAX_SITEMAPS && !outOfTime(ctx.deadline)) {
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
    // Kept, not discarded. Every page of `/products.json` already carries the
    // title and pictures a chooser needs; throwing them away meant asking the
    // store again, once per card, for what we had just downloaded.
    const cards: CatalogCard[] = [];
    const origin = originOf(ctx.baseUrl);

    // Paginate products.json until empty — no artificial cap
    let page = 1;
    let emptyStreak = 0;
    while (emptyStreak < 1) {
      if (ctx.signal?.aborted) throw new Error('aborted');
      // What has been listed so far is a result. Waiting for the rest is not.
      if (outOfTime(ctx.deadline)) {
        warnings.push('This store was slow to list its catalogue, so only part of it was read');
        break;
      }
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
        cards.push(cardOf(origin, p));
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
      cards,
      estimatedTotal: keys.size || productUrls.size || null,
      // A store whose own product API answered but refused us leaves nothing
      // to read but the pages themselves, one request each. That is what
      // gymshark.com does, and it is the run worth batching.
      byPage: hints.includes(JSON_BLOCKED),
      warnings,
      hints,
    };
  },

  /**
   * The chosen products, read from the listing instead of a page each.
   *
   * Walks `/products.json` only until every handle asked for has been found,
   * so a small pick is usually one request and the whole catalogue is a
   * handful. Returns null the moment the listing refuses us, because then the
   * pages are the only way in and the caller already knows how to read them.
   */
  async fetchSome(ctx, urls): Promise<CatalogProduct[] | null> {
    const origin = originOf(ctx.baseUrl);
    const handleOf = (u: string) => {
      const raw = /\/products\/([^/?#]+)/i.exec(u)?.[1];
      return raw ? decodeURIComponent(raw) : null;
    };
    const want = new Set(urls.map(handleOf).filter((h): h is string => Boolean(h)));
    if (!want.size) return null;

    const out: CatalogProduct[] = [];
    let page = 1;
    while (want.size) {
      if (ctx.signal?.aborted) throw new Error('aborted');
      if (outOfTime(ctx.deadline)) break;
      const { products, blocked } = await fetchProductsJsonPage(ctx, page);
      // A store that will not serve its listing has nothing to offer here.
      if (blocked && page === 1) return null;
      if (!products.length) break;
      for (const p of products) {
        const h = String(p.handle ?? '');
        if (want.delete(h)) {
          out.push(mapShopifyProduct(origin, p));
          ctx.onProgress?.({ stage: 'fetching_products', fetched: out.length });
        }
      }
      if (products.length < 250) break;
      page++;
      if (page > 10_000) break;
    }
    return out.length ? out : null;
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
    // Skipped when the bulk walk already returned everything discovery counted
    // - the leftovers are then sitemap aliases of products we hold, and asking
    // for each one is a request per alias against the endpoint most likely to
    // be guarded.
    const bulkCoveredAll = out.length > 0 && out.length >= discovered.productKeys.length;
    if (!jsonBlocked && !bulkCoveredAll) {
      const missingUrls = stillMissing();
      if (missingUrls.length) {
        let refusedRun = 0;
        let abandoned = false;
        await mapPool(
          missingUrls,
          4,
          async (u) => {
            if (abandoned) return;
            const handle = handleOf(u);
            if (!handle) return;
            const { ok, json, challenged } = await httpJson<{ product?: any }>(`${origin}/products/${handle}.json`, {
              fetchImpl: ctx.fetchImpl,
              signal: ctx.signal,
            });
            if (!ok) {
              // Stop asking the endpoint, not the store. Whatever is still
              // missing falls through to the product pages below, which a
              // storefront serves freely even when its JSON is guarded.
              if (challenged || ++refusedRun >= JSON_GIVE_UP) abandoned = true;
              return;
            }
            refusedRun = 0;
            if (json?.product) {
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
