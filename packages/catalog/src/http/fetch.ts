import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  assertPublicHost,
  coolHost,
  hostOf,
  isChallenge,
  retryAfterMs,
  throttleBackoff,
  waitForHost,
} from '@scenri/brand';
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
 * that injects a `fetchImpl` other than the global is a test double or an
 * already-guarded implementation, and resolving names for it would be both
 * pointless and, for the reserved `.example` domains tests use, slow enough
 * to matter. A literal address and the scheme are checked either way,
 * because those need nobody's help to be dangerous.
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
 * Re-exported so this module stays the one import site a crawler needs, and so
 * the tests that already name them here keep working. The rules themselves now
 * live in `@scenri/brand` beside `assertPublicHost`, because the brand scraper
 * is a second client against the same hosts and had none of them.
 */
export { isChallenge, retryAfterMs };

/** Bounded fetch with timeout, polite UA, and exponential backoff on 429/5xx. */
export async function httpGet(url: string, opts: HttpOptions = {}): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 25_000;
  let lastErr: unknown;
  // The real network whenever the fetch is the real one, handed in or not:
  // every production caller hands in the global (`?? fetch` in pipeline.ts,
  // candidates.ts, cli/src/catalogImport.ts and cli/src/routes/catalogImport.ts),
  // and a name there must be looked up like any other.
  const real = !opts.fetchImpl || opts.fetchImpl === globalThis.fetch;

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
        await assertReachable(current, real);
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
      // A door, not a queue. Retrying costs three more identical refusals and
      // the cooldown they arm is shared, so the endpoints that do answer wait
      // behind an endpoint that never will. Hand it back and let the caller
      // stop asking this one thing.
      if (isChallenge(res)) return res;
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
): Promise<{ ok: boolean; status: number; text: string; url: string; challenged: boolean }> {
  const res = await httpGet(url, opts);
  const challenged = isChallenge(res);
  const text = await readBounded(res, opts.maxBytes);
  return { ok: res.ok, status: res.status, text, url: res.url || url, challenged };
}

export async function httpJson<T = unknown>(
  url: string,
  opts: HttpOptions = {},
): Promise<{ ok: boolean; status: number; json: T | null; url: string; text: string; challenged: boolean }> {
  const res = await httpGet(url, { ...opts, accept: opts.accept ?? 'application/json' });
  const challenged = isChallenge(res);
  /**
   * A refused JSON endpoint answers with a whole HTML page, and this used to
   * read it with no ceiling at all.
   *
   * The ceiling has to clear a real answer by a wide margin, because a
   * truncated body is not a smaller answer - it is a parse error, and the
   * store reads as empty. Measured 2026-09-16: one page of 250 products from
   * www.rothys.com is 2,333,750 bytes, and a 2 MB cap turned that store into
   * "no products found" while every request answered 200. Sixteen leaves room
   * for a catalogue with far longer descriptions and still bounds the reply.
   */
  const text = await readBounded(res, opts.maxBytes ?? 16_000_000);
  let json: T | null = null;
  if (res.ok) {
    try {
      json = JSON.parse(text) as T;
    } catch {
      json = null;
    }
  }
  return { ok: res.ok && json !== null, status: res.status, json, url: res.url || url, text, challenged };
}

/**
 * Whether a discovery deadline has passed.
 *
 * Lives here rather than beside the type because every adapter already imports
 * this module for its value exports, and `types.ts` is imported as types only.
 */
export function outOfTime(deadline: number | undefined): boolean {
  return deadline != null && Date.now() > deadline;
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
