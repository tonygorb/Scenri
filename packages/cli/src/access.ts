import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type CodeProblem, codePage } from './network/codePage.js';
import { normalizeCode } from './network/phoneAccess.js';

/**
 * Hostnames that unambiguously mean "the machine running this server".
 *
 * `0.0.0.0` is deliberately absent even though a server may bind to it:
 * browsers will happily load `http://0.0.0.0:4747`, which is a way to reach a
 * local server through an address the user never recognises as their own.
 */
const LOOPBACK = ['localhost', '127.0.0.1', '::1'];

/**
 * The cookie a device carries after arriving with the code, named for the
 * port: cookies ignore ports, so two Scenris on one machine (a worktree lane
 * beside the main one) would otherwise overwrite each other on a phone.
 */
export const ACCESS_COOKIE = 'sc_access';
export const cookieName = (port: number | null | undefined): string =>
  port ? `${ACCESS_COOKIE}_${port}` : ACCESS_COOKIE;

/**
 * The pre-rename spelling. Read, never written, so a tab that was already open
 * across an upgrade is not bounced back to the code page. The name is not the
 * secret: whichever cookie carries the value, it still has to match the code,
 * so this widens no trust.
 */
const LEGACY_ACCESS_COOKIE = 'bt_access';

/** A phone stays signed in for as long as browsers allow a cookie to live. */
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

/**
 * Six characters are safe only because guessing is slow: ten different wrong
 * codes from one address in ten minutes, then that address waits. Distinct
 * values, so a phone replaying one stale cookie on every request counts once.
 */
const WRONG_LIMIT = 10;
const WRONG_WINDOW_MS = 10 * 60_000;

export interface AccessOptions {
  /** Hostnames accepted beyond loopback names and IPv4 addresses: a SCENRI_HOST given as a name. */
  allowedHosts?: string[];
  /** The code every device other than this computer brings. Unset, nothing is gated beyond the host check. */
  code?: () => string | undefined;
  /** The studio's port, which names the cookie. */
  port?: () => number | null;
  /** A device other than this computer got in. */
  onVisit?: (remote: string | undefined, ua: string | undefined) => void;
  now?: () => number;
}

/**
 * The `Host` header carries a port we do not care about, and IPv6 literals
 * arrive wrapped in brackets. Reduce both to a bare hostname.
 */
export function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const h = hostHeader.trim().toLowerCase();
  if (!h) return null;
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? null : h.slice(1, end);
  }
  // more than one colon and no brackets means a bare IPv6 literal: malformed
  // per RFC 7230 but harmless to pass through, and it will not match anyway
  if ((h.match(/:/g) ?? []).length > 1) return h;
  const colon = h.lastIndexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

/**
 * An IPv4 address as a Host is never DNS rebinding: rebinding needs a name the
 * attacker controls, and a page whose origin is an IP address is already that
 * address. So every address this machine has, today's Wi-Fi or tomorrow's,
 * passes without a list that goes stale when the network changes.
 */
export function isIPv4Literal(host: string): boolean {
  const parts = host.split('.');
  return host !== '0.0.0.0' && parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

const isLoopbackAddress = (addr: string | undefined): boolean =>
  !!addr && (addr === '::1' || addr.startsWith('127.') || addr.startsWith('::ffff:127.'));

/**
 * The person sitting at this machine: a connection from the loopback, asking
 * for a loopback name. Both, because a local proxy (Vite with --host) turns a
 * phone's request into a loopback connection that still names the Wi-Fi
 * address, and that phone must bring the code like any other.
 */
export function fromThisComputer(req: FastifyRequest): boolean {
  const host = hostnameOf(req.headers.host);
  return !!host && LOOPBACK.includes(host) && isLoopbackAddress(req.socket?.remoteAddress);
}

function codeMatches(expected: string, supplied: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(normalizeCode(supplied));
  // timingSafeEqual throws on a length mismatch, and the length is not a secret
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function createLimiter(now: () => number) {
  const seen = new Map<string, { since: number; wrong: Set<string> }>();
  const entry = (ip: string) => {
    const e = seen.get(ip);
    if (e && now() - e.since <= WRONG_WINDOW_MS) return e;
    seen.delete(ip);
    return null;
  };
  return {
    locked: (ip: string) => (entry(ip)?.wrong.size ?? 0) >= WRONG_LIMIT,
    wrong(ip: string, value: string) {
      let e = entry(ip);
      if (!e) {
        e = { since: now(), wrong: new Set() };
        seen.set(ip, e);
        // a bounded memory, whoever is knocking
        if (seen.size > 1000) seen.delete(seen.keys().next().value as string);
      }
      e.wrong.add(normalizeCode(value));
    },
  };
}

/** A browser opening a page gets a page it can act on; everything else gets the JSON the studio reads. */
function refuse(req: FastifyRequest, reply: FastifyReply, problem: CodeProblem) {
  const accept = String(req.headers.accept ?? '');
  const isPage =
    (req.method === 'GET' || req.method === 'HEAD') &&
    (req.headers['sec-fetch-mode'] === 'navigate' || accept.includes('text/html'));
  if (isPage) {
    return reply
      .status(403)
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(codePage(problem));
  }
  return reply.status(403).send({ error: problem === 'locked' ? 'too many tries' : 'access code required' });
}

/**
 * Three gates, in order.
 *
 * The host check exists because a fixed port on loopback is reachable from any
 * page the user has open: an attacker resolves their own domain to 127.0.0.1
 * and the browser sends requests here with `Host: evil.example`. Same-origin
 * policy does not help, because the browser believes the origin is theirs.
 * Rejecting an unfamiliar `Host` is what closes it, and it is the same check
 * Jupyter, Ollama and Docker Desktop ship.
 *
 * The cross-site check catches classic CSRF, which the host check cannot.
 *
 * The code gate covers every device that is not this computer: the API has no
 * accounts, so whoever reaches the port could otherwise spend the user's keys
 * and delete their library.
 *
 * Register this before any route: Fastify only applies a hook to routes added
 * after it.
 */
export function registerAccessGuard(app: FastifyInstance, opts: AccessOptions = {}): void {
  const named = new Set([...LOOPBACK, ...(opts.allowedHosts ?? []).map((h) => h.trim().toLowerCase())]);
  const limiter = createLimiter(opts.now ?? Date.now);

  app.addHook('onRequest', async (req, reply) => {
    const host = hostnameOf(req.headers.host);
    if (!host || !(named.has(host) || isIPv4Literal(host))) {
      return reply.status(403).send({ error: 'forbidden host' });
    }
    // Browsers stamp every request with Sec-Fetch-Site, so a cross-site one
    // names itself: a page on any origin can fire a body-less POST at us with
    // a Host header we trust, and a POST without a content-type never triggers
    // a preflight. The one legitimate cross-site shape is someone opening
    // their own studio from a link: a top-level navigation, always a GET.
    // Non-browser clients (curl, npm, the launcher's self-probe) send no
    // Sec-Fetch-* headers and pass untouched.
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      const isNavigation =
        req.headers['sec-fetch-mode'] === 'navigate' && (req.method === 'GET' || req.method === 'HEAD');
      if (!isNavigation) return reply.status(403).send({ error: 'cross-site request blocked' });
    }

    const code = opts.code?.();
    if (!code || fromThisComputer(req)) return;

    const ip = req.socket?.remoteAddress ?? '';
    const q = (req.query as Record<string, unknown> | undefined)?.t;
    const fromQuery = typeof q === 'string' && q ? q : undefined;
    const header = req.headers['x-access-token'];
    const port = opts.port?.() ?? null;
    const supplied =
      fromQuery ??
      (typeof header === 'string' ? header : undefined) ??
      cookieValue(req.headers.cookie, cookieName(port)) ??
      cookieValue(req.headers.cookie, ACCESS_COOKIE) ??
      cookieValue(req.headers.cookie, LEGACY_ACCESS_COOKIE);

    if (limiter.locked(ip)) return refuse(req, reply, 'locked');
    if (supplied && codeMatches(code, supplied)) {
      if (fromQuery) {
        // Hand the browser a cookie so the studio's later requests carry the
        // code without it having to stay in the address bar.
        reply.header(
          'set-cookie',
          `${cookieName(port)}=${encodeURIComponent(code)}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Strict`,
        );
      }
      opts.onVisit?.(ip, req.headers['user-agent']);
      return;
    }
    if (supplied) {
      limiter.wrong(ip, supplied);
      if (limiter.locked(ip)) return refuse(req, reply, 'locked');
    }
    // a stale cookie is not something the person just typed wrong
    return refuse(req, reply, fromQuery ? 'wrong' : null);
  });
}
