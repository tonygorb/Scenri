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
