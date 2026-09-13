/**
 * Reading one product page.
 *
 * Every adapter ends up here when a platform's own API is unavailable, which
 * is the normal case more often than it looks: gymshark.com is a Shopify
 * store whose CDN answers 403 to `/products.json` and to every
 * `/products/<handle>.json`, while serving the product pages themselves 200
 * with a complete `ProductGroup` in `application/ld+json`.
 *
 * This lived inside the generic adapter, and generic, WooCommerce and Webflow
 * each kept their own copy of the loop around it. Shopify never got a copy,
 * so a blocked JSON endpoint meant an empty catalog from a readable store.
 * One copy now, and `generic.ts` re-exports the three names its importers
 * already use.
 */
import { createHash } from 'node:crypto';
import { httpText, mapPool } from '../http/fetch.js';
import { absolutize } from '../url.js';
import { normalizeProduct } from '../normalize.js';
import { attr, loadHtml, textOf } from '../html.js';
import type { AdapterContext, CatalogProduct, CatalogVariant } from '../types.js';

export function stableKey(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/** An `image` entry in schema.org JSON-LD: a URL, or an ImageObject carrying one. */
type JsonLdImage = string | { url?: string; contentUrl?: string };

const typesOf = (obj: Record<string, unknown>): string[] => {
  const t = obj['@type'];
  const list = Array.isArray(t) ? t : t ? [t] : [];
  return list.map((x) => String(x).toLowerCase());
};

/**
 * Collect the product-shaped nodes, keeping groups and singles apart.
 *
 * schema.org models a garment sold in several sizes as a `ProductGroup` whose
 * `hasVariant` holds one `Product` per size. Matching only `Product` and
 * recursing into every value - which is what this did - turns one shirt into
 * seven products that share a sku, and `dedupeProducts` then collapses them
 * back to one while throwing away every size, price and availability. So the
 * group is claimed first and its members are not emitted a second time.
 */
function walkJsonLd(node: unknown, groups: any[], singles: any[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const n of node) walkJsonLd(n, groups, singles);
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const types = typesOf(obj);
  if (types.includes('productgroup')) groups.push(obj);
  else if (types.includes('product')) singles.push(obj);
  if (obj['@graph']) walkJsonLd(obj['@graph'], groups, singles);
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') walkJsonLd(v, groups, singles);
  }
}

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

function imagesOf(n: any, pageUrl: string) {
  return ([] as JsonLdImage[])
    .concat(n.image ?? [])
    .flat()
    .map((img) => (typeof img === 'string' ? img : (img?.url ?? img?.contentUrl)))
    .filter(Boolean)
    .map((u, i) => ({ url: absolutize(pageUrl, String(u))!, position: i, width: null, height: null, alt: null }))
    .filter((img) => img.url);
}

const offerOf = (n: any) => (Array.isArray(n?.offers) ? n.offers[0] : n?.offers);

/**
 * The property names a group says its members differ by.
 *
 * `variesBy` is a list of schema.org property URLs ("https://schema.org/size"),
 * so the last segment is the property to read off each variant.
 */
function variesBy(group: any): string[] {
  const named = asArray(group.variesBy)
    .map((v) => String(v).split('/').pop() ?? '')
    .filter(Boolean);
  return named.length ? named : ['size', 'color'];
}

function variantsOf(group: any, keys: string[]): CatalogVariant[] {
  return asArray(group.hasVariant)
    .filter((v) => v && typeof v === 'object')
    .map((v, i) => {
      const offer = offerOf(v);
      const options = Object.fromEntries(
        keys.map((k) => [k, v[k]]).filter(([, val]) => val != null && val !== ''),
      ) as Record<string, string>;
      // gymshark.com publishes the same sku on all seven sizes of a garment,
      // so the sku alone names one variant seven times. The option values are
      // what actually tell them apart, and they are stable across imports.
      const base = String(v.sku || v.mpn || v.gtin || `${group.productGroupID ?? group.name ?? 'group'}:${i}`);
      const suffix = Object.values(options).join('/');
      return {
        externalKey: suffix ? `${base}:${suffix}` : base,
        title: [v.name, ...Object.values(options)].filter(Boolean).join(' '),
        sku: v.sku ? String(v.sku) : null,
        price: offer?.price != null ? Number(offer.price) : null,
        compareAtPrice: null,
        currency: offer?.priceCurrency ?? null,
        available: offer?.availability ? /instock/i.test(String(offer.availability)) : null,
        options,
      };
    });
}

function fromGroup(group: any, pageUrl: string): CatalogProduct {
  const keys = variesBy(group);
  const variants = variantsOf(group, keys);
  const url = absolutize(pageUrl, String(group.url ?? group['@id'] ?? pageUrl)) ?? pageUrl;
  // A group's own `image` is the one the store chose to represent it. Only
  // when it has none is a variant's picture better than nothing.
  const images = imagesOf(group, pageUrl);
  const fallback = images.length ? images : imagesOf(asArray(group.hasVariant)[0] ?? {}, pageUrl);
  return normalizeProduct({
    externalKey: String(group.productGroupID || group.sku || stableKey(url)),
    title: String(group.name ?? 'Product'),
    descriptionHtml: group.description ? String(group.description) : null,
    url,
    vendor: group.brand?.name ?? (typeof group.brand === 'string' ? group.brand : null),
    productType: group.category ? String(group.category) : null,
    category: group.category ? String(group.category) : null,
    price: variants.find((v) => v.price != null)?.price ?? null,
    compareAtPrice: null,
    currency: variants.find((v) => v.currency)?.currency ?? null,
    available: variants.some((v) => v.available) || null,
    tags: [],
    variants,
    images: fallback,
    raw: group,
  });
}

function fromSingle(n: any, pageUrl: string): CatalogProduct {
  const offers = offerOf(n);
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
    images: imagesOf(n, pageUrl),
    raw: n,
  });
}

export function extractJsonLdProducts(
  html: string,
  pageUrl: string,
  doc?: ReturnType<typeof loadHtml>,
): CatalogProduct[] {
  const root = doc ?? loadHtml(html);
  const groups: any[] = [];
  const singles: any[] = [];
  for (const el of root.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = el.innerHTML;
    if (!raw) continue;
    try {
      walkJsonLd(JSON.parse(raw), groups, singles);
    } catch {
      /* ignore broken blocks */
    }
  }
  const claimed = new Set<object>();
  for (const g of groups) for (const v of asArray(g.hasVariant)) if (v && typeof v === 'object') claimed.add(v);
  return [
    ...groups.map((g) => fromGroup(g, pageUrl)),
    ...singles.filter((n) => !claimed.has(n)).map((n) => fromSingle(n, pageUrl)),
  ];
}

/**
 * Things only a page that sells something has.
 *
 * Deliberately strict, and every one of them is a claim the page makes about
 * itself rather than a shape we inferred. A title and a picture are not a
 * product: without this, oatly.com came back with 201 of them, made out of
 * blog posts, because every page on the web has a title and a picture.
 */
const PRODUCT_MARKERS = [
  'meta[property="og:type"][content="product"]',
  'meta[property="product:price:amount"]',
  'meta[property="og:price:amount"]',
  '[itemtype*="schema.org/Product"]',
  '[itemprop="price"]',
  '[itemprop="offers"]',
  'form[action*="/cart/add"]',
  '[name="add"]',
];
const BUY_WORDS = /add to (cart|bag|basket)|buy now|add to my bag/i;

/**
 * Pictures on a product page that are not the product.
 *
 * The flags are not hypothetical: gymshark.com's product pages carry a
 * country picker, and the twelve images scraped from one of them are a single
 * packshot, four campaign shots and seven national flags.
 *
 * Naming them is not enough, though, and that is the useful part. Those flags
 * are served as `/_next/static/media/us.bc5e2f3b.svg` - no `flag` anywhere in
 * the URL to match on. What gives them away is the directory: a framework's
 * build-asset folder holds interface furniture, never catalog photography.
 * `/_next/image?url=...` is the opposite case, an optimiser standing in front
 * of real content, so it stays.
 */
const BUILD_ASSET = /\/_next\/static\/|\/static\/media\/|\/assets\/(icons|flags|ui)\//i;
const NOT_A_PACKSHOT =
  /logo|icon|sprite|pixel|avatar|\bflags?\b|\/flags?\/|locale|country|currency|badge|payment|social/i;

export function looksLikeProduct(html: string, doc?: ReturnType<typeof loadHtml>): boolean {
  const $ = doc ?? loadHtml(html);
  for (const sel of PRODUCT_MARKERS) {
    try {
      if ($.querySelector(sel)) return true;
    } catch {
      // A selector this parser will not take is not evidence either way.
    }
  }
  for (const el of $.querySelectorAll('button, input[type="submit"], a')) {
    const words = `${textOf(el)} ${attr(el, 'value') ?? ''} ${attr(el, 'aria-label') ?? ''}`;
    if (BUY_WORDS.test(words)) return true;
  }
  return false;
}

type PageImage = { url: string; position: number; width: null; height: null; alt: string | null };

/** The pictures a page shows, og:image first, interface furniture dropped. */
function galleryImages($: ReturnType<typeof loadHtml>, pageUrl: string, cap = 12): PageImage[] {
  const images: PageImage[] = [];
  const og = attr($.querySelector('meta[property="og:image"]'), 'content');
  if (og) {
    const abs = absolutize(pageUrl, og);
    if (abs) images.push({ url: abs, position: 0, width: null, height: null, alt: null });
  }
  for (const el of $.querySelectorAll('img[src]')) {
    if (images.length >= cap) break;
    const src = attr(el, 'src') || attr(el, 'data-src');
    const abs = src ? absolutize(pageUrl, src) : null;
    if (!abs || NOT_A_PACKSHOT.test(abs) || BUILD_ASSET.test(abs)) continue;
    if (images.some((x) => x.url === abs)) continue;
    images.push({ url: abs, position: images.length, width: null, height: null, alt: attr(el, 'alt') ?? null });
  }
  return images;
}

export function parseProductHtml(
  html: string,
  pageUrl: string,
  doc?: ReturnType<typeof loadHtml>,
): CatalogProduct | null {
  // A page that never claims to sell anything is not a product, whatever else
  // it has on it. This is the line between importing a catalog and inventing one.
  const $ = doc ?? loadHtml(html);
  if (!looksLikeProduct(html, $)) return null;
  const title =
    attr($.querySelector('meta[property="og:title"]'), 'content') ||
    textOf($.querySelector('h1')) ||
    textOf($.querySelector('title'));
  if (!title) return null;
  const desc =
    attr($.querySelector('meta[property="og:description"]'), 'content') ||
    attr($.querySelector('meta[name="description"]'), 'content') ||
    null;
  const images = galleryImages($, pageUrl);
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
/**
 * Whether a JSON-LD node is offering the thing for sale, rather than merely
 * mentioning it.
 *
 * A price, a stock-keeping identifier or a set of variants is commercial
 * evidence a page publishes about itself. A bare `@type: Product` carrying
 * only a name and a picture is not: that shape also turns up in review
 * blocks, related-item carousels and editorial round-ups.
 */
function sellsSomething(p: CatalogProduct): boolean {
  const n = (p.raw ?? {}) as Record<string, unknown>;
  return Boolean(n.offers || n.sku || n.gtin || n.mpn || n.hasVariant || p.price != null);
}

/**
 * One page, whatever it is willing to say about itself.
 *
 * Structured data first, the page's own markup second, and neither is taken
 * on trust. The markup path is gated on `looksLikeProduct` because a title
 * and a picture are not a product - that is what turned oatly.com's blog into
 * 201 of them. The structured path is gated on commercial evidence instead,
 * because a declared price is a stronger claim than an Add to cart button,
 * and plenty of real storefronts render the button in the browser. A page
 * that clears either gate is a product page.
 */
function withGallery(product: CatalogProduct, doc: ReturnType<typeof loadHtml>, pageUrl: string): CatalogProduct {
  const have = new Set((product.images ?? []).map((i) => i.url));
  const extra = galleryImages(doc, pageUrl).filter((i) => !have.has(i.url));
  if (!extra.length) return product;
  const images = [...(product.images ?? [])];
  for (const img of extra) {
    if (images.length >= 12) break;
    images.push({ ...img, position: images.length });
  }
  return { ...product, images };
}

export function productsFromPage(html: string, url: string): CatalogProduct[] {
  // Parsed once. This called `loadHtml` three times on the same string, and a
  // gymshark page is 2.4 MB: 16 ms and 10 MB of heap per parse, three times
  // over, 2,201 times.
  const doc = loadHtml(html);
  const declared = looksLikeProduct(html, doc);
  const fromLd = extractJsonLdProducts(html, url, doc);
  const selling = declared ? fromLd : fromLd.filter(sellsSomething);
  // One structured product means this page is about that product, so its
  // gallery belongs to it. Stores commonly declare a single hero image in
  // JSON-LD while showing six angles on the page, and Scenri wants the
  // angles. Several products means a listing, where the pictures belong to
  // no single one of them.
  if (selling.length === 1) return [withGallery(selling[0], doc, url)];
  if (selling.length) return selling;
  if (!declared) return [];
  const one = parseProductHtml(html, url, doc);
  return one ? [one] : [];
}

export interface PageFetchOptions {
  /** Requests in flight. A stranger's live store, so this stays small. */
  concurrency?: number;
  /**
   * How many products the caller wants, not how many pages to read.
   *
   * A sitemap is a list of addresses and some of them lead nowhere useful:
   * oatly.com's bare product URLs are 301 stubs that redirect to a locale,
   * and six of them in a row yielded one product. Reading exactly the first N
   * addresses would hand someone a preview of one card and a count of 130.
   */
  want?: number;
  /** The real ceiling on requests, however few products they turn up. */
  maxPages?: number;
  /** Bytes kept from one page. Product pages reach megabytes. */
  maxBytes?: number;
  /** A ceiling across the whole run, so heavy pages stop it sooner. */
  maxTotalBytes?: number;
  /** `Date.now()` past which no further page is requested. */
  deadline?: number;
  /** A store asking to be read slowly, from its robots.txt. */
  delayMs?: number;
  onProduct?: (total: number) => void;
  /**
   * Each product, the moment its page parsed.
   *
   * Given this, the crawl keeps nothing: the caller owns every product as it
   * arrives and the returned array stays empty. That is what lets an import
   * write a product a second into a store of thousands without ever holding
   * the catalogue, and what puts them on screen one at a time instead of in
   * visible steps.
   */
  onEach?: (p: CatalogProduct) => void;
  /**
   * Filled in as work happens, so a caller can report what it really spent.
   *
   * `refused` counts pages the site would not serve. A crawl swallows those so
   * one bad address cannot end a run, which also meant a shop that started
   * turning us away mid-catalogue looked exactly like a shop with very few
   * products: gymshark.com answered 413 pages and then 405 with
   * `x-amzn-waf-action: captcha` for the rest, and the import called itself
   * finished. Counting them is what lets a caller say which happened.
   */
  stats?: { pages: number; bytes: number; refused?: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Read a bounded set of product pages and return what they claim to sell.
 *
 * Deduped by `externalKey` as it goes, so a store that lists the same item
 * under several paths costs pages but never yields copies.
 */
export async function fetchProductPages(
  ctx: AdapterContext,
  urls: string[],
  opts: PageFetchOptions = {},
): Promise<CatalogProduct[]> {
  const out: CatalogProduct[] = [];
  const seen = new Set<string>();
  /** Products yielded, whether or not they were kept here. */
  let kept = 0;
  const want = opts.want ?? Number.POSITIVE_INFINITY;
  // Three addresses per product wanted, so a site full of stubs costs a
  // bounded amount more rather than an unbounded one.
  const ceiling = opts.maxPages ?? (Number.isFinite(want) ? want * 3 : urls.length);
  const take = urls.slice(0, ceiling);
  let bytes = 0;
  await mapPool(
    take,
    opts.delayMs ? 1 : (opts.concurrency ?? 5),
    async (u) => {
      if (kept >= want) return;
      if (opts.deadline != null && Date.now() > opts.deadline) return;
      if (opts.maxTotalBytes != null && bytes >= opts.maxTotalBytes) return;
      try {
        if (opts.delayMs) await sleep(opts.delayMs);
        const { ok, text, url } = await httpText(u, {
          fetchImpl: ctx.fetchImpl,
          signal: ctx.signal,
          accept: 'text/html',
          maxBytes: opts.maxBytes,
        });
        bytes += text.length;
        if (opts.stats) {
          opts.stats.pages += 1;
          opts.stats.bytes = bytes;
        }
        if (!ok) {
          if (opts.stats) opts.stats.refused = (opts.stats.refused ?? 0) + 1;
          return;
        }
        for (const p of productsFromPage(text, url)) {
          if (seen.has(p.externalKey)) continue;
          seen.add(p.externalKey);
          kept++;
          if (opts.onEach) opts.onEach(p);
          else out.push(p);
        }
        opts.onProduct?.(kept);
      } catch {
        // One unreadable page is not a reason to abandon the rest.
      }
    },
    ctx.signal,
  );
  return out;
}
