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
 * The trigram index needs three characters. A shorter term is read off each
 * shot's indexed text instead (`shortTermSql`), so the feed narrows from the
 * first letter. One or two letters match the start of a word, in the text and
 * in names (`nameMatches`): inside words nearly every shot holds them ("x" is
 * in every shot Codex made), so the first letter would narrow nothing. Below
 * this the shot's own accents are not folded: "e" finds "easel", not "éclair".
 */
export const TRIGRAM_MIN = 3;

/** A term of letters and digits, which has word starts to match; anything else is matched where it stands. */
const WORDY = /^[\p{L}\p{N}]+$/u;

/** Whether a term is short enough to match the start of a word rather than anywhere. */
const byWordStart = (term: SearchTerm) => term.text.length < TRIGRAM_MIN && WORDY.test(term.text);

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

/**
 * Whether a product, person, scene or engine name answers a term: at the start
 * of one of its words for one or two letters, anywhere from three.
 */
export function nameMatches(name: string, term: SearchTerm): boolean {
  if (!byWordStart(term)) return termMatches(name, term);
  return fold(name)
    .split(/[^\p{L}\p{N}]+/u)
    .some((w) => w.startsWith(term.text));
}

/** Whether every term matches: the client's `matchesQuery`, for tests and for names. */
export function matchesQuery(haystack: string, q: string): boolean {
  const terms = searchTerms(q);
  if (!terms.length) return true;
  return terms.every((t) => termMatches(haystack, t));
}

const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * The SQL that answers a term the trigram index is too short for, against a
 * text column, or null when the index can. Letters and digits match the start
 * of a word: the text lowered (ASCII, as the term already is) and globbed
 * after anything that is not a letter or a digit. Anything else is a
 * substring, with `%` and `_` escaped so they match only themselves.
 */
export function shortTermSql(
  term: SearchTerm,
  column: string,
  param: string,
): { sql: string; params: Record<string, string> } | null {
  if (term.text.length >= TRIGRAM_MIN) return null;
  if (byWordStart(term))
    return {
      sql: `(lower(${column}) GLOB @${param}a OR lower(${column}) GLOB @${param}b)`,
      params: { [`${param}a`]: `${term.text}*`, [`${param}b`]: `*[^a-z0-9]${term.text}*` },
    };
  return {
    sql: `${column} LIKE @${param} ESCAPE '\\'`,
    params: { [param]: `%${term.text.replace(/[\\%_]/g, (c) => `\\${c}`)}%` },
  };
}

/** The FTS5 MATCH expression for one term, or null when the term is too short for the trigram index. */
export function ftsMatch(term: SearchTerm): string | null {
  if (term.text.length < TRIGRAM_MIN) return null;
  return term.stem ? `(${quote(term.text)} OR ${quote(term.stem)})` : quote(term.text);
}
