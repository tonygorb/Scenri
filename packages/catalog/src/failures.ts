/**
 * Why one thing in a catalog import did not work.
 *
 * A crawl swallows a page it cannot read, so that one bad address cannot end a
 * run. Without a reason attached, that swallowing is indistinguishable from a
 * store that simply has fewer products: a real shop behind a rate limiter
 * answered 429 to nearly every page and the import reported itself finished,
 * having saved nothing. Counting is not enough - the count has to say what
 * happened, or nobody can tell a slow shop from a shut one.
 *
 * These are diagnostics, never copy. `summarise` turns a run's tally into the
 * one sentence a person should read.
 */
export type FailureReason =
  | 'RATE_LIMITED'
  | 'CHALLENGED'
  | 'PAGE_BLOCKED'
  | 'PAGE_NOT_FOUND'
  | 'PAGE_UNREADABLE'
  | 'IMAGE_FORBIDDEN'
  | 'IMAGE_NOT_FOUND'
  | 'IMAGE_TIMEOUT'
  | 'IMAGE_EMPTY'
  | 'UNSUPPORTED_MEDIA'
  | 'DOWNLOAD_FAILED'
  | 'ABORTED'
  | 'UNKNOWN';

export type FailureTally = Partial<Record<FailureReason, number>>;

/**
 * What an HTTP status means for a product page we tried to read.
 *
 * `challenged` separates a door from a queue. Both arrive as 429, but waiting
 * fixes one and never fixes the other, so telling someone to try again later
 * would be advice that cannot work.
 */
export function pageFailure(status: number, challenged = false): FailureReason {
  if (challenged) return 'CHALLENGED';
  if (status === 429 || status === 503) return 'RATE_LIMITED';
  if (status === 401 || status === 403 || status === 405) return 'PAGE_BLOCKED';
  if (status === 404 || status === 410) return 'PAGE_NOT_FOUND';
  return 'PAGE_UNREADABLE';
}

/** The same, for a picture. A refused picture is not a refused page. */
export function imageFailure(status: number): FailureReason {
  if (status === 429 || status === 503) return 'RATE_LIMITED';
  if (status === 401 || status === 403) return 'IMAGE_FORBIDDEN';
  if (status === 404 || status === 410) return 'IMAGE_NOT_FOUND';
  return 'DOWNLOAD_FAILED';
}

/** What a thrown request means, which is usually the network rather than the site. */
export function thrownFailure(err: unknown, aborted = false): FailureReason {
  if (aborted) return 'ABORTED';
  // Node says "The operation was aborted" and "The operation timed out", and
  // undici says "fetch failed" with the reason underneath. Matching only the
  // word "timeout" missed every real one of them.
  const m = String((err as any)?.message ?? err).toLowerCase();
  if (m.includes('abort') || m.includes('timed out') || m.includes('timeout')) return 'IMAGE_TIMEOUT';
  return 'DOWNLOAD_FAILED';
}

export function tally(into: FailureTally, reason: FailureReason, n = 1): void {
  into[reason] = (into[reason] ?? 0) + n;
}

/**
 * Whichever reason dominates a run, or null when nothing failed.
 *
 * A reason recorded as zero is not a reason. `tally` never writes one, but a
 * caller passing a pre-seeded shape could, and it would otherwise win the sort
 * on an empty run and put "0 of 10 products are no longer on the site" in
 * front of someone whose import went perfectly.
 */
function leadingReason(t: FailureTally): FailureReason | null {
  const rows = (Object.entries(t) as [FailureReason, number][]).filter(([, n]) => n > 0);
  if (!rows.length) return null;
  return rows.sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * One sentence for a person, from what actually went wrong.
 *
 * Never the enum, never a status code. A rate limit is the one worth naming
 * plainly, because it is the one the person can do something about: wait, and
 * press the button again.
 */
/**
 * How many of the things a person asked for did not arrive.
 *
 * Two wrong answers to avoid, both of which shipped. `asked - saved` counts
 * products against addresses, and one address can carry several: measured
 * 2026-09-16, six addresses of which three were dead produced five products,
 * and the sentence read "1 of 6 are no longer on the site" when three of them
 * were. Counting the failure tally instead undercounts the opposite way, because
 * a run that gives up early never attempts the rest: 40 addresses with 10
 * readable records 26 refusals and leaves 4 untried, and the person is still
 * missing 30.
 *
 * So: what was asked for, minus what actually worked. `worked` is addresses,
 * never products, which is the unit the question was asked in.
 */
export function shortfall(asked: number, worked: number): number {
  return Math.max(0, asked - Math.max(0, worked));
}

export function summarise(t: FailureTally, saved: number, asked: number, failedCount?: number): string | null {
  const reason = leadingReason(t);
  if (!reason) return null;
  const none = saved === 0;
  const failed = Math.min(asked, failedCount ?? Math.max(0, asked - saved));
  switch (reason) {
    case 'RATE_LIMITED':
      return none
        ? 'The store asked us to slow down, so nothing could be read. Waiting a few minutes and trying again usually works.'
        : `The store asked us to slow down partway, so ${failed} of ${asked} products were skipped. Trying again picks up the rest.`;
    // Never "try again in a few minutes": this one does not clear with time,
    // and saying so would be advice that cannot work.
    case 'CHALLENGED':
      return none
        ? 'This store checks that visitors are a web browser, so its catalogue could not be read automatically. You can still add products by hand.'
        : `This store started checking that visitors are a web browser, so ${failed} of ${asked} products were skipped.`;
    case 'PAGE_BLOCKED':
      return none
        ? 'This store would not let us read its product pages.'
        : `${failed} of ${asked} product pages would not open.`;
    case 'PAGE_NOT_FOUND':
      return `${failed} of ${asked} products are no longer on the site.`;
    case 'IMAGE_FORBIDDEN':
    case 'IMAGE_NOT_FOUND':
    case 'IMAGE_TIMEOUT':
    case 'IMAGE_EMPTY':
    case 'UNSUPPORTED_MEDIA':
    case 'DOWNLOAD_FAILED':
      return none
        ? 'We found the products, but none of their pictures could be downloaded.'
        : 'Some pictures could not be downloaded. The products they belong to are still here.';
    case 'ABORTED':
      return null;
    default:
      return none ? 'The products on this site could not be read.' : null;
  }
}
