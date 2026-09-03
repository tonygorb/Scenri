/**
 * The search semantics the studio's library pages use, ported for the feed
 * query so a search over twenty thousand shots is answered by the index and
 * finds exactly what the client-side pass found: every whitespace-separated
 * term must appear as a substring, ignoring case and accents, and a trailing
 * plural on a term of four letters or more also matches its singular.
 *
 * Keep in step with `apps/studio/src/layout/library/libraryRules.ts`
 * (`fold`, `matchesQuery`); both carry the same fixture cases in their tests.
 */

/** Lowercase, combining marks and invisible bidi controls stripped. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g, '')
    .toLowerCase();
}

/** Below this a term is too short to strip a plural from safely. */
export const STEM_MIN = 4;

/**
 * The trigram index needs three characters. A shorter term filters no text
 * at all (it still matches a name resolved by the caller): the feed narrows
 * on the third letter, the way every trigram-backed search does, rather than
 * scanning every shot's text for the first two. The library pages, which
 * search a catalog on the client, keep matching from the first letter.
 */
export const TRIGRAM_MIN = 3;

export interface SearchTerm {
  /** The folded term as typed. */
  text: string;
  /** Its singular, when the plural rule applies. */
  stem: string | null;
}

/** The terms of a query, folded and split; empty for a blank query. */
export function searchTerms(q: string): SearchTerm[] {
  return fold(q)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((text) => ({
      text,
      stem: text.length >= STEM_MIN && text.endsWith('s') ? text.slice(0, -1) : null,
    }));
}

/** Whether one term matches a haystack, by the same rule the client applies. */
export function termMatches(haystack: string, term: SearchTerm): boolean {
  const h = fold(haystack);
  return h.includes(term.text) || (term.stem !== null && h.includes(term.stem));
}

/** Whether every term matches: the client's `matchesQuery`, for tests and for names. */
export function matchesQuery(haystack: string, q: string): boolean {
  const terms = searchTerms(q);
  if (!terms.length) return true;
  return terms.every((t) => termMatches(haystack, t));
}

const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** The FTS5 MATCH expression for one term, or null when the term is too short for the trigram index. */
export function ftsMatch(term: SearchTerm): string | null {
  if (term.text.length < TRIGRAM_MIN) return null;
  return term.stem ? `(${quote(term.text)} OR ${quote(term.stem)})` : quote(term.text);
}
