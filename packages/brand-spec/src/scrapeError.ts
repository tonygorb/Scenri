// SPDX-License-Identifier: Apache-2.0
/**
 * A failure the scraper can explain, carrying the status it should be served
 * with. Fastify's error handler already reads `statusCode`, so a route needs
 * no try/catch to turn a bad paste into a 400 and an unreachable site into a
 * 502 - the same idiom the catalog import already uses.
 *
 * This exists because the alternative shipped: an unguarded `new URL` threw a
 * bare TypeError, the handler forwarded its message verbatim, and "Invalid
 * URL" became the entire explanation a person got.
 */
export type ScrapeErrorCode =
  | 'url_empty'
  | 'url_scheme'
  | 'url_space'
  | 'url_host'
  | 'url_unparseable'
  | 'blocked_host'
  | 'too_many_redirects'
  | 'unreachable'
  | 'timeout'
  | 'http_status'
  | 'not_a_page'
  | 'too_large';

export class ScrapeError extends Error {
  readonly name = 'ScrapeError';
  constructor(
    readonly code: ScrapeErrorCode,
    message: string,
    readonly statusCode: 400 | 502 = 502,
    /**
     * What the site actually answered, when it answered at all.
     *
     * Carried because the caller has to tell two failures apart that read the
     * same from here: a site that is there and will not talk to us, and an
     * address with nothing behind it. The first should still produce a brand;
     * the second is a typo and must not.
     */
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

/**
 * Whether a site answered us at all, rudely.
 *
 * 401, 403, 429 and every 5xx mean a server is there and declining. 404 does
 * not: it means this address has no page, which is a different sentence and a
 * different outcome.
 */
export function isRefusal(err: unknown): boolean {
  if (!(err instanceof ScrapeError)) return false;
  if (err.code === 'timeout') return true;
  if (err.code !== 'http_status' || err.httpStatus === undefined) return false;
  return err.httpStatus === 401 || err.httpStatus === 403 || err.httpStatus === 429 || err.httpStatus >= 500;
}

/** The reason a URL was refused, as the error the routes already understand. */
export function urlRefusal(reason: string, message: string): ScrapeError {
  return new ScrapeError(`url_${reason}` as ScrapeErrorCode, message, 400);
}
