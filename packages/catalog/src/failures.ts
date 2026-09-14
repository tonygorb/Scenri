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
  | 'PAGE_BLOCKED'
  | 'PAGE_NOT_FOUND'
  | 'PAGE_UNREADABLE'
  | 'IMAGE_FORBIDDEN'
  | 'IMAGE_NOT_FOUND'
  | 'IMAGE_TIMEOUT'
  | 'IMAGE_EMPTY'
  | 'IMAGE_UNREADABLE'
  | 'DOWNLOAD_FAILED'
  | 'MEDIA_SAVE_FAILED'
  | 'PRODUCT_SAVE_FAILED'
  | 'ABORTED'
  | 'UNKNOWN';

export type FailureTally = Partial<Record<FailureReason, number>>;

/** What an HTTP status means for a product page we tried to read. */
export function pageFailure(status: number): FailureReason {
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
  const m = String((err as any)?.message ?? err).toLowerCase();
  if (m.includes('abort') || m.includes('timeout')) return 'IMAGE_TIMEOUT';
  return 'DOWNLOAD_FAILED';
}

export function tally(into: FailureTally, reason: FailureReason, n = 1): void {
  into[reason] = (into[reason] ?? 0) + n;
}

/** Whichever reason dominates a run, or null when nothing failed. */
export function leadingReason(t: FailureTally): FailureReason | null {
  const rows = Object.entries(t) as [FailureReason, number][];
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
export function summarise(t: FailureTally, saved: number, asked: number): string | null {
  const reason = leadingReason(t);
  if (!reason) return null;
  const none = saved === 0;
  switch (reason) {
    case 'RATE_LIMITED':
      return none
        ? 'The store asked us to slow down, so nothing could be read. Waiting a few minutes and trying again usually works.'
        : `The store asked us to slow down partway, so ${asked - saved} of ${asked} products were skipped. Trying again picks up the rest.`;
    case 'PAGE_BLOCKED':
      return none
        ? 'This store would not let us read its product pages.'
        : `${asked - saved} of ${asked} product pages would not open.`;
    case 'PAGE_NOT_FOUND':
      return `${asked - saved} of ${asked} products are no longer on the site.`;
    case 'IMAGE_FORBIDDEN':
    case 'IMAGE_NOT_FOUND':
    case 'IMAGE_TIMEOUT':
    case 'IMAGE_EMPTY':
    case 'IMAGE_UNREADABLE':
    case 'DOWNLOAD_FAILED':
      return none
        ? 'We found the products, but none of their pictures could be downloaded.'
        : 'Some pictures could not be downloaded. The products they belong to are still here.';
    case 'MEDIA_SAVE_FAILED':
    case 'PRODUCT_SAVE_FAILED':
      return 'Some products could not be saved on this computer.';
    case 'ABORTED':
      return null;
    default:
      return none ? 'The products on this site could not be read.' : null;
  }
}
