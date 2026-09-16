// SPDX-License-Identifier: Apache-2.0
/**
 * Fetching a page a person pasted, bounded.
 *
 * Scenri is local-first: this is the same process reading the same public page
 * the user could open in a tab, and nothing about a brand URL leaves the
 * machine. What it is not is unbounded. The old path followed redirects with
 * no cap, read the body with no size limit, and cleared its own timeout in a
 * `finally` BEFORE awaiting `res.text()` - so the only guard it had was off
 * for the whole download. There is no timer here at all: one signal covers
 * connect, headers and every byte of the body.
 *
 * The address guard is proportionate, not theatre. A local-first app whose
 * user pastes an address should not be turned into a probe of their own
 * network, and `169.254.169.254` should not be reachable from a brand field.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ScrapeError } from './scrapeError.js';
import { coolHost, isChallenge, retryAfterMs, throttleBackoff, waitForHost } from './hostManners.js';

export type FetchKind = 'html' | 'css' | 'asset';

export interface GuardOptions {
  /** The whole scrape, sub-resources included. */
  budgetMs?: number;
  /** One request, connect through last body byte. */
  requestMs?: number;
  maxRedirects?: number;
  maxHtmlBytes?: number;
  maxCssBytes?: number;
  maxAssetBytes?: number;
  /** Only the e2e fixture server sets this. Never a default. */
  allowPrivateHosts?: boolean;
  /** Injected for tests; node's DNS otherwise. */
  lookup?: (host: string) => Promise<string[]>;
  fetchImpl?: typeof fetch;
}

export interface GuardedResponse {
  finalUrl: string;
  status: number;
  contentType: string;
  bytes: Buffer;
  text: string;
  truncated: boolean;
}

export interface GuardedFetch {
  (url: string, as: FetchKind): Promise<GuardedResponse>;
  /** Milliseconds left in the whole-scrape budget. Callers skip optional work at zero. */
  remaining(): number;
}

const DEFAULTS = {
  budgetMs: 20_000,
  requestMs: 8_000,
  maxRedirects: 3,
  maxHtmlBytes: 3_000_000,
  maxCssBytes: 1_000_000,
  maxAssetBytes: 5_000_000,
};

/**
 * Addresses a public website is never actually at. Loopback, link-local
 * (which is where cloud metadata lives), the RFC 1918 ranges, CGNAT, the
 * documentation and benchmark ranges, multicast and broadcast.
 */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind === 6) return isPrivateV6(ip.toLowerCase());
  return true; // not an address at all: refuse rather than guess
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.0/24 and 192.0.2/24
  if (a === 192 && b === 88) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  if (a === 203 && b === 0) return true;
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isPrivateV6(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '');
  if (bare === '::' || bare === '::1') return true;
  // An embedded v4 address is still that v4 address.
  const mapped = /^(?:::ffff:|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(bare);
  if (mapped) return isPrivateV4(mapped[1]);
  const head = bare.split(':')[0];
  if (/^f[cd]/.test(head)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(head)) return true; // fe80::/10 link-local
  if (/^ff/.test(head)) return true; // multicast
  if (head === '2002') return true; // 6to4 wraps a v4 address we cannot see
  return false;
}

/** Hostnames that never belong to a public website, whatever they resolve to. */
const PRIVATE_SUFFIX = /(^|\.)(local|internal|localhost|home\.arpa)$/i;

export function assertPublicHost(host: string, addresses: readonly string[], allow: boolean): void {
  if (allow) return;
  const bare = host.replace(/^\[|\]$/g, '');
  // An address typed straight in answers for itself; no lookup can change it.
  if (isIP(bare)) {
    if (isPrivateAddress(bare)) throw blocked(host);
    return;
  }
  // A bare name with no dot is a machine on this network, not a website.
  if (!bare.includes('.') || PRIVATE_SUFFIX.test(bare)) throw blocked(host);
  if (addresses.length === 0) throw new ScrapeError('unreachable', `Could not reach ${host}.`);
  if (addresses.some((a) => isPrivateAddress(a))) throw blocked(host);
}

const blocked = (host: string) =>
  new ScrapeError('blocked_host', `${host} points at this computer or a private network, not a public website.`, 400);

const LIMIT: Record<FetchKind, keyof typeof DEFAULTS> = {
  html: 'maxHtmlBytes',
  css: 'maxCssBytes',
  asset: 'maxAssetBytes',
};

/** HTML and CSS are read as far as the cap; an image past it is refused outright. */
const TRUNCATES: Record<FetchKind, boolean> = { html: true, css: true, asset: false };

export function createGuardedFetch(opts: GuardOptions = {}): GuardedFetch {
  const o = { ...DEFAULTS, ...opts };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const resolve =
    opts.lookup ??
    (async (host: string) => {
      if (isIP(host.replace(/^\[|\]$/g, ''))) return [host.replace(/^\[|\]$/g, '')];
      const all = await dnsLookup(host, { all: true });
      return all.map((a) => a.address);
    });
  const deadline = Date.now() + o.budgetMs;
  const remaining = () => Math.max(0, deadline - Date.now());

  async function once(url: string, as: FetchKind): Promise<GuardedResponse> {
    let current = url;
    // Two separate budgets: a redirect is the site sending us somewhere else,
    // a retry is the same request again. Spending one on the other is how a
    // redirect cap stops meaning what it says.
    let hops = 0;
    let attempts = 0;
    for (;;) {
      const u = new URL(current);
      if (u.protocol !== 'http:' && u.protocol !== 'https:')
        throw new ScrapeError(
          'url_scheme',
          'Scenri reads web addresses only, the ones that start with http or https.',
          400,
        );
      let addresses: string[] = [];
      if (!o.allowPrivateHosts) {
        try {
          addresses = await resolve(u.hostname);
        } catch {
          throw new ScrapeError('unreachable', `Could not reach ${u.hostname}.`);
        }
      }
      assertPublicHost(u.hostname, addresses, Boolean(o.allowPrivateHosts));

      // Whatever this host last told anyone - this scrape, or the catalog
      // crawl that shares the map - before spending a request on it.
      await waitForHost(u.host);
      const left = remaining();
      if (left <= 0) throw new ScrapeError('timeout', 'Reading that site took too long.');
      const signal = AbortSignal.any([AbortSignal.timeout(Math.min(o.requestMs, left))]);
      let res: Response;
      try {
        res = await fetchImpl(current, {
          redirect: 'manual',
          headers: { 'user-agent': USER_AGENT, accept: ACCEPT[as] },
          signal,
        });
      } catch (err) {
        if (err instanceof ScrapeError) throw err;
        const aborted = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
        throw aborted
          ? new ScrapeError('timeout', `${u.hostname} took too long to answer.`)
          : new ScrapeError('unreachable', `Could not reach ${u.hostname}.`);
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        // Cancel rather than leak the socket while we decide about the next hop.
        await res.body?.cancel().catch(() => {});
        if (!location) throw new ScrapeError('http_status', `${u.hostname} answered ${res.status} with nowhere to go.`);
        if (++hops > o.maxRedirects)
          throw new ScrapeError(
            'too_many_redirects',
            `${new URL(url).hostname} kept redirecting, so nothing was read.`,
          );
        current = new URL(location, current).toString();
        continue;
      }
      if (!res.ok) {
        const refused = () =>
          new ScrapeError('http_status', statusSentence(u.hostname, res.status, isChallenge(res)), 502, res.status);
        // A door, not a queue. A challenge asks for a browser we are not, so
        // every retry fails identically and each one teaches the host to
        // refuse us for longer. Hand it back at once.
        if (isChallenge(res)) {
          await res.body?.cancel().catch(() => {});
          throw refused();
        }
        // A CDN in front of a big storefront refuses a share of requests and
        // serves the next one fine: gymshark.com answered 403 once and 200 a
        // minute later, to the same user agent. One patient retry turns a dead
        // end into a kit, and one is the limit - a site that refuses twice
        // means it.
        if (RETRYABLE.has(res.status)) {
          // The host's own number beats our guess, and arming the shared
          // cooldown is the point of sharing it: the catalog scan runs against
          // this same host seconds from now, and used to arrive knowing
          // nothing about what just happened here.
          const wait = retryAfterMs(res.headers.get('retry-after')) ?? throttleBackoff(attempts);
          coolHost(u.host, wait);
          // A scrape has 20 seconds in total, so a site asking for 60 is
          // asking for more than this request has to give. Respect it by
          // leaving rather than by waiting: the cooldown above already told
          // everyone else.
          if (attempts < 1 && remaining() > wait + 2_000) {
            await res.body?.cancel().catch(() => {});
            await sleep(wait);
            attempts++;
            continue;
          }
        }
        throw refused();
      }

      const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
      const cap = o[LIMIT[as]];
      const { bytes, truncated } = await readBounded(res, cap, TRUNCATES[as]);
      assertKind(as, contentType, bytes, u.hostname);
      return {
        finalUrl: res.url || current,
        status: res.status,
        contentType,
        bytes,
        text: as === 'asset' ? '' : decode(bytes, contentType),
        truncated,
      };
    }
  }

  const guarded = ((url: string, as: FetchKind) => once(url, as)) as GuardedFetch;
  guarded.remaining = remaining;
  return guarded;
}

export const USER_AGENT = 'scenri/0.1 (+https://scenri.co)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Statuses a site can answer once and not the next time.
 *
 * 403 is in here on evidence rather than principle. A real permission refusal
 * will not change, but the overwhelmingly common 403 on a public marketing
 * page is a CDN bot check, and those do change: gymshark.com answered 403 in
 * the app and 200 from a shell a minute later, to the same user agent. One
 * extra request is a fair price for that.
 */
const RETRYABLE = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

/**
 * What a status means to a person who did not ask for a number.
 *
 * "answered 403" is accurate and useless: nobody can act on it, and the most
 * common cause by far is a CDN refusing anything that is not a browser, which
 * is not the person's fault and not something they can fix by trying harder.
 */
export function statusSentence(host: string, status: number, challenged = false): string {
  // A challenge is not a queue, so "try again in a minute" would be advice
  // that cannot work: waiting changes nothing when the door is asking for a
  // browser. It reads like the 403 it really is.
  if (challenged || status === 401 || status === 403)
    return `${host} would not let Scenri read it. Some sites block anything that is not a person in a browser; you can still add the logo and colours by hand.`;
  if (status === 404) return `There is no page at that address on ${host}.`;
  if (status === 429) return `${host} asked Scenri to slow down. Try again in a minute.`;
  if (status >= 500) return `${host} had trouble answering. Try again in a moment.`;
  return `${host} answered ${status}, so there was nothing to read.`;
}

const ACCEPT: Record<FetchKind, string> = {
  html: 'text/html,application/xhtml+xml',
  css: 'text/css,*/*;q=0.1',
  asset: 'image/*',
};

/** Read the body, counting as we go, so a cap is a cap and not a hope. */
async function readBounded(
  res: Response,
  cap: number,
  truncate: boolean,
): Promise<{ bytes: Buffer; truncated: boolean }> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (!truncate && declared > cap) {
    await res.body?.cancel().catch(() => {});
    throw new ScrapeError('too_large', 'That file is too large to read.');
  }
  const reader = res.body?.getReader();
  if (!reader) return { bytes: Buffer.from(await res.arrayBuffer()), truncated: false };
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    total += value.byteLength;
    if (total >= cap) {
      await reader.cancel().catch(() => {});
      if (!truncate) throw new ScrapeError('too_large', 'That file is too large to read.');
      return { bytes: Buffer.concat(chunks).subarray(0, cap), truncated: true };
    }
  }
  return { bytes: Buffer.concat(chunks), truncated: false };
}

const IMAGE_MAGIC: [string, (b: Buffer) => boolean][] = [
  ['png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['jpeg', (b) => b[0] === 0xff && b[1] === 0xd8],
  ['gif', (b) => b.subarray(0, 3).toString('latin1') === 'GIF'],
  ['webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
  ['ico', (b) => b[0] === 0x00 && b[1] === 0x00 && (b[2] === 0x01 || b[2] === 0x02)],
  ['svg', (b) => /<svg[\s>]/i.test(b.subarray(0, 1024).toString('utf8'))],
];

function assertKind(as: FetchKind, contentType: string, bytes: Buffer, host: string): void {
  if (as === 'html') {
    const htmlish = /text\/html|application\/xhtml/.test(contentType);
    // A server that labels its markup text/plain is not rare, and a header is
    // a weaker claim than the bytes. Sniffing keeps a CSV or a PDF out either
    // way, which is the part that matters before cheerio sees anything.
    const vague = contentType === '' || /^text\/plain|^application\/octet-stream/.test(contentType);
    const looksLikeMarkup = vague && bytes.subarray(0, 512).toString('utf8').trimStart().startsWith('<');
    if (!htmlish && !looksLikeMarkup)
      throw new ScrapeError('not_a_page', `${host} answered with a file, not a web page.`);
    return;
  }
  if (as === 'asset') {
    // A server that declares an image, or declares nothing, gets the benefit of
    // the doubt: sharp is the real decoder and its refusal is already a warning
    // a person can read. What is refused here is a positive claim to be
    // something else - a page, a JSON error, a PDF - which has no business
    // reaching an image pipeline at all.
    if (contentType.startsWith('image/')) return;
    const vague = contentType === '' || /^application\/octet-stream/.test(contentType);
    if (vague || IMAGE_MAGIC.some(([, test]) => test(bytes))) return;
    throw new ScrapeError('not_a_page', 'That logo was not an image.');
  }
}

/** Most of the web is UTF-8; the rest says so, and a wrong guess is not fatal. */
function decode(bytes: Buffer, contentType: string): string {
  const declared = /charset=([\w-]+)/i.exec(contentType)?.[1];
  const sniffed = declared ?? /charset=["']?([\w-]+)/i.exec(bytes.subarray(0, 1024).toString('latin1'))?.[1];
  const label = (sniffed ?? 'utf-8').toLowerCase();
  if (label === 'utf-8' || label === 'utf8') return bytes.toString('utf8');
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
}
