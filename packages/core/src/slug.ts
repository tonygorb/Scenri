/**
 * A name, made safe to be a path segment — and, deliberately, safe to *read*.
 *
 * A slug is typed back, pasted into chat, read aloud on a support call: ASCII
 * only, regardless of what script the real name is written in. The name
 * itself is untouched everywhere else in the app (brand.json.meta.name, every
 * heading, every generated brief) — this is only ever the address bar.
 *
 * Latin accents fold to their base letter first, because "café" and "cafe"
 * are the same word to anyone typing a URL. Every other script — Hebrew,
 * Arabic, Cyrillic, Greek, CJK — is then treated exactly like punctuation
 * always was: a join, not content. A name that is nothing *but* another
 * script (no Latin substring at all) reduces to the bare fallback here;
 * `slugifyWithId` below is what keeps two such names from colliding into
 * indistinguishable brand-2/brand-3.
 */
export const slugify = (s: string, fallback = 'brand'): string =>
  s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48)
    .replace(/-+$/g, '') || fallback;

/**
 * `slugify`, but a name with no usable Latin content falls back to a slice of
 * the row's own id instead of the bare fallback word. Without this, every
 * Hebrew-only, Arabic-only or CJK-only name in a brand's whole history landed
 * on the same "brand" seed and got told apart only by firstFree's -2/-3
 * suffix — unique, but with nothing in the URL that says which is which. A
 * hex slice of the real id is still ASCII and is unique on its own.
 */
export const slugifyWithId = (s: string, id: string, fallback = 'brand'): string => {
  const base = slugify(s, fallback);
  return base === fallback ? `${fallback}-${id.slice(0, 8)}` : base;
};

/**
 * Slugs a brand may not hold, because the web root is not ours alone.
 *
 * A brand lives at /<slug>, and four names at that level already belong to
 * someone: `api` is the server's whole namespace and its not-found handler
 * answers there in JSON, so every page under a brand called that would come
 * back as an error rather than the app; `assets` is the directory the studio
 * builds into and is served from the same root; `b` is the old scheme the
 * redirect shim still answers for; `setup` is the app's own first-run wizard.
 *
 * Nothing else can collide. Sections (`create`, `sets`, `kit`, `looks`) sit a
 * level below a brand and set slugs a level below those, so neither can reach
 * the root — and `slugify` turns every character that is not a letter or a
 * digit into a hyphen, so no slug can ever be spelled like a file.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(['api', 'assets', 'b', 'setup']);

/** First free name in a series: acme, then acme-2, acme-3. */
export function firstFree(base: string, taken: (candidate: string) => boolean): string {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!taken(candidate)) return candidate;
  }
}
