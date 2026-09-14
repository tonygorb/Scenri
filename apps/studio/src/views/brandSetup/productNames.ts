/**
 * The name a product URL already carries.
 *
 * A sitemap hands back every address for free, and turning one into a card
 * costs a page read. But the address is not silent: Shopify, WooCommerce and
 * most of the rest put the product's own handle in the path, so
 * `/products/gymshark-vital-seamless-shorts-dark-green-marl-logo` is a
 * readable name before anything is fetched.
 *
 * That is what makes a catalogue of 2203 searchable without reading 2203
 * pages: search the names we already have, and pay only for what gets looked
 * at. The name is replaced by the real title the moment its card loads.
 */
const NOISE = /^(p|product|products|item|items|dp|sku)$/i;

export function nameFromUrl(url: string): string {
  let slug = '';
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    slug = [...parts].reverse().find((part) => !NOISE.test(part) && !/^\d+$/.test(part)) ?? parts.at(-1) ?? '';
  } catch {
    slug = url;
  }
  const words = decodeURIComponent(slug)
    .replace(/\.(html?|php|aspx?)$/i, '')
    .replace(/[-_+]+/g, ' ')
    .trim();
  if (!words) return url;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Case and punctuation insensitive, so "vital seamless" finds "Vital-Seamless". */
export function matches(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const hay = flat(haystack);
  return flat(needle)
    .split(' ')
    .filter(Boolean)
    .every((word) => hay.includes(word));
}
