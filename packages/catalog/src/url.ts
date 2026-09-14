/** Normalize a user-pasted store/brand URL into an origin + clean path base. */
export function normalizeStoreUrl(input: string): string {
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('url must be http(s)');
  }
  // Drop tracking params and fragments
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_|ref$|_ga)/i.test(key)) u.searchParams.delete(key);
  }
  u.hash = '';
  // Prefer bare origin for store roots; keep path if user pasted a collection/product path
  const path = u.pathname.replace(/\/+$/, '') || '';
  const looksLikeProductOrCollection = /\/(products|collections|product|shop|store|catalogue|catalog)\b/i.test(path);
  if (!looksLikeProductOrCollection) {
    u.pathname = '/';
    u.search = '';
  } else {
    u.pathname = path || '/';
  }
  return u.toString().replace(/\/$/, '') || u.origin;
}

export function originOf(url: string): string {
  return new URL(url).origin;
}

export function absolutize(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** Prefer largest Shopify CDN image by rewriting size suffixes. */
export function upgradeImageUrl(url: string): string {
  try {
    const u = new URL(url);
    // Shopify: foo_200x200.jpg / foo_small.jpg → foo.jpg
    u.pathname = u.pathname
      .replace(/_(pico|icon|thumb|small|compact|medium|large|grande|\d+x\d*)(\.[a-z]+)$/i, '$2')
      .replace(/_(pico|icon|thumb|small|compact|medium|large|grande|\d+x\d*)$/i, '');
    if (u.searchParams.has('width')) u.searchParams.delete('width');
    if (u.searchParams.has('height')) u.searchParams.delete('height');
    // Prefer master / original when query allows
    if (/cdn\.shopify\.com/i.test(u.hostname) && !u.searchParams.has('format')) {
      // leave as-is; removing size suffix is enough
    }
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * The same catalog, listed once per language, collapsed back to once.
 *
 * A store that sells in several markets publishes a product sitemap per
 * locale, and the sitemap index lists all of them. gymshark.com's index
 * carries both `/sitemap_products_1.xml` and `/es-US/sitemap_products_1.xml`,
 * so discovery came back with 4404 URLs for 2202 products - half the pages we
 * would read, and a count twice the size of the catalog, before a single
 * duplicate was caught downstream by external key.
 *
 * A locale segment is two letters, optionally with a region ("/es-US/",
 * "/de/"), and it only counts as one when the same path exists without it.
 * A store that publishes nothing but localised URLs keeps all of them: there
 * is no canonical form there to prefer.
 */
const LOCALE_SEGMENT = /^\/[a-z]{2}(?:-[A-Za-z]{2})?\//;

export function preferCanonicalLocale(urls: string[]): string[] {
  const canonical = new Set<string>();
  for (const u of urls) {
    try {
      const parsed = new URL(u);
      if (!LOCALE_SEGMENT.test(parsed.pathname)) canonical.add(`${parsed.origin}${parsed.pathname}`);
    } catch {
      /* an unparseable entry is left where it is */
    }
  }
  if (!canonical.size) return urls;
  return urls.filter((u) => {
    try {
      const parsed = new URL(u);
      if (!LOCALE_SEGMENT.test(parsed.pathname)) return true;
      const stripped = parsed.pathname.replace(LOCALE_SEGMENT, '/');
      return !canonical.has(`${parsed.origin}${stripped}`);
    } catch {
      return true;
    }
  });
}
