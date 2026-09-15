import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { assertPublicHost } from '@scenri/brand';
import type { FetchImpl } from '../types.js';

/**
 * Where a crawl is allowed to go.
 *
 * A store URL arrives from a request body, and every page it names can
 * redirect somewhere else, so both the address asked for and the address each
 * hop lands on have to be checked. Without this a request naming
 * `169.254.169.254` - or a public domain redirecting to it - made the server
 * fetch it and hand the contents back.
 *
 * The rule itself lives in `@scenri/brand` and is imported rather than
 * copied: a security control with two implementations has two places to get
 * it wrong, and only one of them gets fixed.
 */
const ALLOW_PRIVATE = process.env.SCENRI_SCRAPE_ALLOW_PRIVATE === '1';

/**
 * @param real whether this request is going to the actual network. A caller
 * that injects its own `fetchImpl` is a test double or an already-guarded
 * implementation, and resolving names for it would be both pointless and, for
 * the reserved `.example` domains tests use, slow enough to matter. A literal
 * address and the scheme are checked either way, because those need nobody's
 * help to be dangerous.
 */
async function assertReachable(url: string, real: boolean): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Scenri reads http and https addresses only, not ${u.protocol.replace(':', '')}`);
  }
  if (ALLOW_PRIVATE) return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    assertPublicHost(u.hostname, [host], false);
    return;
  }
  if (!real) return;
  let addresses: string[];
  try {
    addresses = (await dnsLookup(host, { all: true })).map((a) => a.address);
  } catch {
    // A name that will not resolve for us will not resolve for the fetch
    // either, so there is nothing here to reach and nothing to refuse.
    return;
  }
  assertPublicHost(u.hostname, addresses, false);
}

export const USER_AGENT = 'scenri-catalog/0.1 (+https://scenri.co)';

export interface HttpOptions {
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  accept?: string;
  /**
   * Stop reading a body past this many bytes and keep what arrived.
   *
   * `res.text()` has no ceiling, and product pages are not small: a single
   * gymshark.com page is 2.4 MB, so a catalog-sized crawl of them is
   * gigabytes. Truncating is safe for our readers - the HTML parser is
   * tolerant, and the JSON-LD block that carries the product sits about a
   * third of the way into that page, well inside any cap worth setting.
   */
  maxBytes?: number;
}

/** Read a response body, stopping at `maxBytes` rather than wherever it ends. */
async function readBounded(res: Response, maxBytes?: number): Promise<string> {
  if (!maxBytes || !res.body) return res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let seen = 0;
  try {
    while (seen < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value.byteLength;
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out + decoder.decode();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

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

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

/** Hold until this host's cooldown has passed. Returns early if the caller stops. */
async function waitForHost(host: string, signal?: AbortSignal): Promise<void> {
  if (!host) return;
  for (;;) {
    const left = (cooledUntil.get(host) ?? 0) - Date.now();
    if (left <= 0 || signal?.aborted) return;
    await sleep(Math.min(left, 250));
  }
}

/** Record that a host wants distance. Never shortens a longer wait already set. */
function coolHost(host: string, ms: number): void {
  if (!host || ms <= 0) return;
  const until = Date.now() + ms;
  if (until > (cooledUntil.get(host) ?? 0)) cooledUntil.set(host, until);
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

/** Backoff for a host that is refusing us: seconds, not milliseconds, and jittered. */
function throttleBackoff(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 16_000);
  return base + Math.floor(Math.random() * 400);
}

/** Bounded fetch with timeout, polite UA, and exponential backoff on 429/5xx. */
export async function httpGet(url: string, opts: HttpOptions = {}): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 25_000;
  let lastErr: unknown;

  const host = hostOf(url);
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Whatever this host last told us, before spending an attempt on it.
    await waitForHost(host, opts.signal);
    if (opts.signal?.aborted) throw new Error('aborted');
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      // Manual redirects, so every hop is checked rather than only the first.
      // `follow` hands the whole chain to undici and a public address that
      // redirects to a private one lands there unseen.
      let current = url;
      let res!: Response;
      for (let hop = 0; ; hop++) {
        await assertReachable(current, !opts.fetchImpl);
        res = await fetchImpl(current, {
          redirect: 'manual',
          signal: ctrl.signal,
          headers: {
            'user-agent': USER_AGENT,
            accept: opts.accept ?? 'application/json, text/html, application/xml, text/xml, */*;q=0.8',
            ...(opts.headers ?? {}),
          },
        });
        if (res.status < 300 || res.status >= 400) break;
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => {});
        if (!location || hop >= 5) break;
        current = new URL(location, current).toString();
      }
      // A manually-redirected response reports the URL of the request that
      // produced it, which is the hop before the last one. Callers resolve
      // relative links against this, so it has to name where we ended up.
      if (res.url !== current) {
        try {
          Object.defineProperty(res, 'url', { value: current, configurable: true });
        } catch {
          /* a response that will not take the property still carries its body */
        }
      }
      // Deliberately not 403. One retry of a single brand page is worth it,
      // because a CDN refuses a share of requests and serves the next one
      // fine. A crawl is the opposite case: retrying a refused endpoint once
      // per product turns a wasted 2202 requests into a wasted 4404.
      //
      // An earlier version of this comment read that gymshark.com "discovered
      // 4406 product URLs and every one answered 403". That was wrong, and it
      // cost a working import: measured 2026-09-13, the 403s were the JSON
      // endpoints (`/products.json`, `/products/<handle>.json`), while every
      // product *page* answered 200 with a complete ProductGroup in its
      // JSON-LD. A refused API is not a refused store, which is why discovery
      // now says so and `productPage.ts` reads the pages instead.
      // A host that is refusing us gets distance, and every other request to
      // it waits too. `Retry-After` is the host's own number and beats ours.
      //
      // The old backoff here was `400 * 2 ** attempt`: four attempts inside
      // about 2.8 seconds, which is nothing to a CDN limiter. A crawl of a
      // rate-limited store burned that budget on every page in parallel and
      // then reported each one as a page with no product on it.
      if (res.status === 429 || res.status === 503) {
        const asked = retryAfterMs(res.headers.get('retry-after'));
        const wait = asked ?? throttleBackoff(attempt);
        coolHost(host, wait);
        if (attempt < retries) {
          await res.body?.cancel().catch(() => {});
          continue;
        }
        return res;
      }
      if (res.status >= 500 && attempt < retries) {
        await sleep(throttleBackoff(attempt));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (opts.signal?.aborted) throw err;
      if (attempt < retries) {
        await sleep(400 * 2 ** attempt);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastErr ?? new Error(`fetch failed: ${url}`);
}

export async function httpText(
  url: string,
  opts: HttpOptions = {},
): Promise<{ ok: boolean; status: number; text: string; url: string }> {
  const res = await httpGet(url, opts);
  const text = await readBounded(res, opts.maxBytes);
  return { ok: res.ok, status: res.status, text, url: res.url || url };
}

export async function httpJson<T = unknown>(
  url: string,
  opts: HttpOptions = {},
): Promise<{ ok: boolean; status: number; json: T | null; url: string; text: string }> {
  const res = await httpGet(url, { ...opts, accept: opts.accept ?? 'application/json' });
  const text = await res.text();
  let json: T | null = null;
  if (res.ok) {
    try {
      json = JSON.parse(text) as T;
    } catch {
      json = null;
    }
  }
  return { ok: res.ok && json !== null, status: res.status, json, url: res.url || url, text };
}

/** Run async work over items with a concurrency limit. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (true) {
      if (signal?.aborted) throw new Error('aborted');
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
