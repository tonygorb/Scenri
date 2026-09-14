// SPDX-License-Identifier: Apache-2.0
export { validateBrand, type ValidationResult } from './validate.js';
export {
  buildFromUrl,
  type BuildOptions,
  type BuildResult,
  type MarkShape,
  type ScrapeReport,
} from './buildFromUrl.js';
export { mergeScrape, type MergeScrapeResult } from './mergeScrape.js';
export { normalizeSiteUrl, type SiteUrl, type SiteUrlReason } from './siteUrl.js';
export { ScrapeError, type ScrapeErrorCode } from './scrapeError.js';
/**
 * The address rule, shared with the catalog crawler.
 *
 * Exported rather than copied: a security control with two implementations
 * has two places to get it wrong, and only one of them gets fixed.
 */
export { assertPublicHost, isPrivateAddress } from './safeFetch.js';
