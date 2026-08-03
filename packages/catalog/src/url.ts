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
