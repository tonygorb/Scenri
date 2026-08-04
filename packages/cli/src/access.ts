import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/**
 * Hostnames that unambiguously mean "the machine running this server".
 *
 * `0.0.0.0` is deliberately absent even though we may bind to it: browsers will
 * happily load `http://0.0.0.0:4747`, which is a way to reach a local server
 * through an address the user never recognises as their own.
 */
const LOOPBACK = ['localhost', '127.0.0.1', '::1'];

/** Cookie the browser carries after arriving with a token in the URL. */
export const ACCESS_COOKIE = 'sc_access';

/**
 * The pre-rename spelling. Read, never written, so a tab that was already open
 * across an upgrade is not bounced back to the token URL. The name is not the
 * secret: whichever cookie carries the value, it still has to survive
 * `tokenMatches`, so this widens no trust.
 */
const LEGACY_ACCESS_COOKIE = 'bt_access';

export interface AccessOptions {
  /** Hostnames accepted beyond loopback, i.e. the LAN addresses we printed. */
  allowedHosts?: string[];
  /** When set, every request must carry this token. Only used for non-loopback binds. */
  token?: string;
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

function tokenMatches(expected: string, supplied: string | undefined): boolean {
  if (!supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  // timingSafeEqual throws on a length mismatch, and the length is not a secret
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * Two gates, in order.
 *
 * The host check exists because a fixed port on loopback is reachable from any
 * page the user has open: an attacker resolves their own domain to 127.0.0.1
 * and the browser sends requests here with `Host: evil.example`. Same-origin
 * policy does not help, because the browser believes the origin is theirs.
 * Rejecting an unfamiliar `Host` is what closes it, and it is the same check
 * Jupyter, Ollama and Docker Desktop ship.
 *
 * The token gate only applies when the server is bound off loopback, where
 * "anyone who can reach the port" stops meaning "the person sitting here".
 *
 * Register this before any route: Fastify only applies a hook to routes added
 * after it.
 */
export function registerAccessGuard(app: FastifyInstance, opts: AccessOptions = {}): void {
  const allowed = new Set([...LOOPBACK, ...(opts.allowedHosts ?? []).map((h) => h.trim().toLowerCase())]);
  const { token } = opts;

  app.addHook('onRequest', async (req, reply) => {
    const host = hostnameOf(req.headers.host);
    if (!host || !allowed.has(host)) {
      return reply.status(403).send({ error: 'forbidden host' });
    }
    if (!token) return;

    const q = (req.query as Record<string, unknown> | undefined)?.t;
    const fromQuery = typeof q === 'string' ? q : undefined;
    const header = req.headers['x-access-token'];
    const supplied =
      fromQuery ??
      (typeof header === 'string' ? header : undefined) ??
      cookieValue(req.headers.cookie, ACCESS_COOKIE) ??
      cookieValue(req.headers.cookie, LEGACY_ACCESS_COOKIE);

    if (!tokenMatches(token, supplied)) {
      return reply.status(403).send({ error: 'access token required' });
    }
    if (fromQuery) {
      // Hand the browser a cookie so the SPA's later fetches carry the token
      // without it having to stay in the address bar.
      reply.header('set-cookie', `${ACCESS_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`);
    }
  });
}
