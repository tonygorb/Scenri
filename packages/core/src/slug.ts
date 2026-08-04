/**
 * A name, made safe to be a path segment, in whatever script it was written in.
 *
 * Latin accents fold to their base letter, because "café" and "cafe" are the
 * same word to anyone typing a URL. Everything else keeps its own letters:
 * stripping to a-z turned every Hebrew, Arabic, Greek, Cyrillic or CJK name
 * into the same empty string, so a studio with Hebrew clients got brand,
 * brand-2, brand-3 instead of names. A browser shows those letters as letters
 * in the address bar and percent-encodes them only on the wire.
 */
export const slugify = (s: string, fallback = 'brand'): string =>
  s
    .normalize('NFKD')
    // fold accents onto Latin bases only. Dropping every combining mark also
    // dropped the hamza off أ, which is not an accent but part of the letter;
    // recomposing puts those back before the filter below sees them
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFC')
    .toLowerCase()
    // anything that is not a letter or a digit — space, punctuation, emoji, and
    // every character that would need escaping in a path — is a join
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48)
    .replace(/-+$/gu, '') || fallback;

/** First free name in a series: acme, then acme-2, acme-3. */
export function firstFree(base: string, taken: (candidate: string) => boolean): string {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!taken(candidate)) return candidate;
  }
}
