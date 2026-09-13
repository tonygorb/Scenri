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
  ) {
    super(message);
  }
}

/** The reason a URL was refused, as the error the routes already understand. */
export function urlRefusal(reason: string, message: string): ScrapeError {
  return new ScrapeError(`url_${reason}` as ScrapeErrorCode, message, 400);
}
