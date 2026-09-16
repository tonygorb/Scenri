// SPDX-License-Identifier: Apache-2.0
/**
 * How Scenri behaves towards a website that is not enjoying our attention.
 *
 * This lives here, beside `assertPublicHost`, for the reason that rule lives
 * here: a control with two implementations has two places to get it wrong, and
 * only one of them gets fixed. That is not hypothetical. The catalog crawler
 * learned about challenges, `Retry-After` and per-host cooldown on 2026-09-16;
 * the brand scraper did not, because it is a different client in a different
 * package. A week later a person pasted a shop and got "asked Scenri to slow
 * down" from the half that had never been taught.
 *
 * Both clients hit the *same host*, seconds apart, during one onboarding: the
 * brand scrape reads the homepage, its stylesheets and its logo, and then the
 * catalog scan reads the shop at the address the scrape just found. Sharing
 * one cooldown map is the whole point - a host annoyed by the first half is
 * approached gently by the second.
 *
 * Nothing here knows about any particular site, and nothing here is tunable.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * How long each host has asked us to stay away, shared by every request.
 *
 * A crawl runs several requests at once, and without this each one discovers a
 * rate limit separately: four workers spend four private retry budgets against
 * a host that has already said no, and all four give up at almost the same
 * moment. Measured on a real store behind Cloudflare, that is the difference
 * between importing 17 of 25 products and importing none of 1,186 - the site
 * answered 429 to nearly everything and the crawl read it as "no product
 * here".
 *
 * One entry per host, only ever extended, cleared by time. Nothing to tune and
 * nothing to reset: a host that stops refusing simply stops being in it.
 */
const cooledUntil = new Map<string, number>();

export const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

/** Hold until this host's cooldown has passed. Returns early if the caller stops. */
export async function waitForHost(host: string, signal?: AbortSignal): Promise<void> {
  if (!host) return;
  for (;;) {
    const left = (cooledUntil.get(host) ?? 0) - Date.now();
    if (left <= 0 || signal?.aborted) return;
    await sleep(Math.min(left, 250));
  }
}

/** Record that a host wants distance. Never shortens a longer wait already set. */
export function coolHost(host: string, ms: number): void {
  if (!host || ms <= 0) return;
  const until = Date.now() + ms;
  if (until > (cooledUntil.get(host) ?? 0)) cooledUntil.set(host, until);
}

/** What a host is still owed, in milliseconds. Zero when it is not waiting on us. */
export function hostCooldownLeft(host: string): number {
  return Math.max(0, (cooledUntil.get(host) ?? 0) - Date.now());
}

/** Forget every cooldown. For tests only; production lets them expire. */
export function clearHostManners(): void {
  cooledUntil.clear();
}

/** Longest we will honour a host's own number, so one bad header cannot park a crawl. */
const RETRY_AFTER_CAP_MS = 60_000;

/**
 * `Retry-After`, in milliseconds, as either a count of seconds or an HTTP date.
 *
 * Asking the server how long to wait beats guessing. Null when it said nothing
 * usable, which is the common case and leaves the caller's own backoff in charge.
 */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const secs = Number(header.trim());
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, RETRY_AFTER_CAP_MS);
  const at = Date.parse(header);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, at - now), RETRY_AFTER_CAP_MS);
}

/**
 * Whether a refusal is an anti-bot challenge rather than a rate limit.
 *
 * The two arrive as the same status and mean opposite things. A rate limit is
 * a queue: wait, and the next request works. A challenge is a door: it asks
 * for a browser we are not, so every retry fails the same way, and each one
 * re-arms the cooldown that `waitForHost` makes every other request share.
 *
 * Measured 2026-09-16 on a Shopify store behind Cloudflare: twenty-four
 * requests to `/products/<handle>.json` answered 429 with `cf-mitigated:
 * challenge` and no `Retry-After`, after which `products.json` and
 * `sitemap.xml` - both 200 a minute earlier - answered the same challenge for
 * minutes. Meanwhile `/products/<handle>` served 200 to all twenty-four at
 * eight wide. Treating that as a rate limit parked the whole host and starved
 * the one endpoint that worked, so 1,186 readable products imported as none.
 *
 * Headers only, deliberately: the body is the caller's to read, and a
 * challenge announces itself before it. `Retry-After` is the tell for a real
 * limiter - a server that tells us when to come back means it.
 */
export function isChallenge(res: Response): boolean {
  if (res.status !== 429 && res.status !== 503) return false;
  if (res.headers.get('cf-mitigated')) return true;
  if (res.headers.get('retry-after')) return false;
  return /text\/html/i.test(res.headers.get('content-type') ?? '');
}

/** Backoff for a host that is refusing us: seconds, not milliseconds, and jittered. */
export function throttleBackoff(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 16_000);
  return base + Math.floor(Math.random() * 400);
}
