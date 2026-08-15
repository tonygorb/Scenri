/**
 * Last pass over every string that leaves in a report.
 *
 * scenri never sees a provider key — `GET /api/settings` answers with booleans
 * (server.ts) — but a *provider* does, and it quotes the key back in its error
 * text. `codex` and `npm` quote absolute paths, which carry the OS username.
 * And the access token from packages/cli/src/index.ts rides in `?t=` on the
 * very first navigation when SCENRI_HOST is off loopback.
 *
 * So the rule is: assume any string may contain a secret, and run everything
 * through here on the way out. Pure and synchronous, so it is testable in
 * jsdom with no renderer.
 */

const REDACTED = '[redacted]';

/** Provider key shapes, most specific first. */
const KEY_SHAPES: RegExp[] = [
  /sk-or-v1-[A-Za-z0-9_-]+/g, // openrouter
  /sk-[A-Za-z0-9_-]{20,}/g, // openai-style, incl. sk-proj-
  /r8_[A-Za-z0-9_-]{20,}/g, // replicate
  /fal_[A-Za-z0-9_-]{20,}/g, // fal
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // github, in case one is pasted into a comment
];

/** A home directory, on any platform, including the username that follows it. */
const HOME_PATHS: [RegExp, string][] = [
  [/\/Users\/[^/\s"'`]+/g, '~'],
  [/\/home\/[^/\s"'`]+/g, '~'],
  [/[A-Za-z]:\\Users\\[^\\\s"'`]+/g, '~'],
];

const IMAGE_HASH = /^[a-f0-9]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A curated catalog id: kebab-case words, e.g. interiors-marble-kitchen-counter
 * or amble-roasting-co-ethiopia-light-roast. These are the single most useful
 * field in a report — the owner has the same file — so they must survive.
 *
 * The dash and the segment cap are what separate them from an opaque token:
 * real ids are dictionary words (longest segment in templates/ is 13), while
 * base64url is one unbroken run and almost always carries an uppercase letter
 * or an underscore.
 */
const isSlug = (s: string): boolean =>
  s.includes('-') && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.split('-').every((w) => w.length <= 14);

/**
 * Anything long and opaque.
 *
 * The access token is 24 random bytes as base64url, which is exactly 32
 * characters — the same length as an image hash — so this cannot be a length
 * rule alone, and the threshold cannot sit on 32 either. It is 24, with an
 * allow-list for the three shapes worth keeping: content hashes, brand UUIDs
 * and catalog slugs.
 */
const OPAQUE = /[A-Za-z0-9_-]{24,}/g;
const keep = (m: string): boolean => IMAGE_HASH.test(m) || UUID.test(m) || isSlug(m);

export function scrub(input: string): string {
  if (!input) return input;
  let s = input;
  for (const re of KEY_SHAPES) s = s.replace(re, REDACTED);
  for (const [re, to] of HOME_PATHS) s = s.replace(re, to);
  s = s.replace(OPAQUE, (m) => (keep(m) ? m : REDACTED));
  return s;
}

/** Query keys worth keeping. Everything else, `t` above all, is dropped. */
const SAFE_QUERY = new Set(['settings', 'tab', 'in', 'branch', 'bi', 'i', 'lineage', 'compose', 'rename']);

/**
 * A URL reduced to what helps debugging: the path, and the handful of query
 * keys that describe which view was open. The origin goes too — it is the LAN
 * address when the studio is reachable from a phone.
 */
export function sanitiseUrl(input: string): string {
  let path = input;
  let query = '';
  try {
    const u = new URL(input, 'http://localhost');
    path = u.pathname;
    const kept = [...u.searchParams.entries()].filter(([k]) => SAFE_QUERY.has(k));
    query = kept.length ? `?${kept.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
  } catch {
    // not a URL: strip a query by hand rather than hand back the token
    path = input.split('?')[0] ?? input;
  }
  return scrub(path + query);
}

/** Walk any JSON-ish value, scrubbing every string in it. */
export function scrubDeep<T>(value: T): T {
  if (typeof value === 'string') return scrub(value) as unknown as T;
  if (Array.isArray(value)) return value.map(scrubDeep) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubDeep(v);
    return out as T;
  }
  return value;
}

/** Trim a string to `n` characters, marking that it was cut. */
export const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n)}…`);
