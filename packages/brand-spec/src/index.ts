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
export { ScrapeError, urlRefusal, type ScrapeErrorCode } from './scrapeError.js';
export { createGuardedFetch, isPrivateAddress, type GuardOptions } from './safeFetch.js';
export { toHex } from './colorParse.js';
export { logoCandidates, svgAsMark, type LogoCandidate, type LogoSource } from './logoCandidates.js';
