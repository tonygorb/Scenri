/**
 * One bounded look at a website, for the commerce half of onboarding.
 *
 * The insight this is built on is that a count and a preview cost completely
 * different amounts, and the old code conflated them. Asking how many
 * products a store has is two requests - a sitemap index and a product
 * sitemap. Reading them is 2.3 MB each, so gymshark.com's 2202 pages are
 * 5.3 GB. So the count is free and never capped, and only the preview is
 * capped, hard.
 *
 * Nothing here writes a product. A candidate is a `CatalogProduct` that has
 * not been persisted - the same type the adapters already produce and
 * `upsertProduct` already consumes, so a chosen candidate needs no second
 * model to become real.
 */
import { adapterFor, detectPlatform } from './detect.js';
import { fetchProductPages } from './adapters/productPage.js';
import { dedupeProducts } from './normalize.js';
import { fetchRobots, isAllowed } from './robots.js';
import { normalizeStoreUrl, originOf } from './url.js';
import type {
  AdapterContext,
  CatalogCard,
  CommerceVerdict,
  CountSource,
  JobProgress,
  ScanBudget,
  ScanResult,
} from './types.js';

/**
 * Measured, not guessed.
 *
 * `maxBytesPerPage`: gymshark.com's JSON-LD sits at bytes 813,068-827,688 of
 * a 2,412,586-byte page, a third of the way in. A 512 KB cap would throw the
 * product away; 1 MB clears it by 170 KB, which is no margin at all on a page
 * that grows. 1.5 MB keeps real headroom and still drops 38% off the wire.
 *
 * `maxPreviewPages`: two or three rows of cards, enough to recognise your own
 * catalog. Against 2202 it is a 99% cut.
 *
 * `concurrency`: this is a stranger's live store. Politeness is free at 24
 * pages, and the behaviour being replaced sent 4406 requests six wide.
 */
export const DEFAULT_SCAN_BUDGET: ScanBudget = {
  maxPreviewPages: 24,
  maxBytesPerPage: 1_500_000,
  maxTotalBytes: 40_000_000,
  budgetMs: 25_000,
  concurrency: 4,
  /**
   * Time the preview is owed even when discovery has already spent the lot.
   *
   * Discovery on a large store can run long, and when it overran the whole
   * budget the preview read zero pages and the store was reported as one we
   * could not open - from a site that was answering every request with a 200.
   * Being slow to list a catalog is not the same as being shut.
   */
  previewFloorMs: 12_000,
};

/**
 * The least time discovery gets, whatever the budget says.
 *
 * Not part of `ScanBudget`: a caller tightening the budget is asking for a
 * shorter look, not for a scan that never looks at all. Measured against real
 * stores, listing takes 1.8 s (lego.certifiedstore.co.il), 3.5 s
 * (allbirds.com) and 22 s (gymshark.com, 2,509 products), so this covers an
 * ordinary catalogue outright and lets the budget govern the large ones.
 */
const DISCOVERY_FLOOR_MS = 8_000;

/**
 * Signals that mean a shop, rather than a platform that can host one.
 *
 * `webflow-html` is deliberately absent: it fires on any site built with
 * Webflow, and on a few that only talk about it.
 */
const COMMERCE_SIGNALS = new Set([
  'products.json',
  'shopify-html',
  'wc-store-api',
  'woocommerce-html',
  'webflow-commerce',
]);

export interface ScanOptions {
  url: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  budget?: Partial<ScanBudget>;
  onProgress?: (update: Partial<JobProgress>) => void;
}

/**
 * A bare domain that turns up no shop, tried once more at `www.`.
 *
 * Nobody types `https://www.`, and the apex is often not where the store is.
 * Following the redirect is the obvious fix and the wrong one: measured
 * 2026-09-13, `gymshark.com` answers 301 to `us.checkout.gymshark.com`, a
 * checkout host with no catalog on it, while `www.gymshark.com` is the store.
 * allbirds.com and oatly.com redirect to their own `www` and would survive
 * either way. So the host is guessed rather than followed, and only when the
 * first look found nothing worth keeping - a site that has a shop never pays
 * for this.
 */
function wwwVariant(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    const labels = url.hostname.split('.');
    // Only a bare registrable domain: never `shop.acme.com`, never an IP.
    if (labels.length !== 2 || /^\d+$/.test(labels[labels.length - 1])) return null;
    url.hostname = `www.${url.hostname}`;
    return url.origin;
  } catch {
    return null;
  }
}

export async function scanForCandidates(opts: ScanOptions): Promise<ScanResult> {
  const first = await scanOnce(opts, originOf(normalizeStoreUrl(opts.url)));
  // Anything short of a catalogue is worth one more look, not just an empty
  // one. gymshark.com redirects to a checkout host, where discovery finds
  // 16,778 addresses and can read none of them - a `blocked` verdict from a
  // store that is perfectly readable one label to the left.
  if (first.verdict === 'found') return first;
  const alternate = wwwVariant(first.baseUrl);
  if (!alternate) return first;
  const second = await scanOnce(opts, alternate);
  return second.verdict === 'found' ? second : first;
}

async function scanOnce(opts: ScanOptions, baseUrl: string): Promise<ScanResult> {
  const started = Date.now();
  const budget = { ...DEFAULT_SCAN_BUDGET, ...opts.budget };
  const deadline = started + budget.budgetMs;
  /**
   * Discovery gets the budget, and the preview is owed its floor after it.
   *
   * The budget used to reach only the page reads: `detectPlatform` and
   * `adapter.discover` ran underneath it with nothing watching the clock, so a
   * store that was slow to list could spend minutes before the budget was
   * consulted once.
   *
   * Holding back the preview's floor from discovery was the obvious split and
   * the wrong one. Counting a catalogue is the slow part on a large store, and
   * thirteen seconds is not enough of it: measured 2026-09-16, allbirds.com
   * counted 294 products against the 588 it has, and a count we cut short is a
   * number we made up. `previewFloorMs` already exists to keep the preview
   * whole when discovery spends everything, so discovery can have the budget
   * and the preview still gets its twelve seconds after it. Worst case is
   * those two added together, which the scan's own hard stop sits above.
   *
   * The floor is the same idea one step earlier: a deadline is read before
   * each request, so a budget already spent when the scan starts would stop
   * discovery before its first one and report a shop as no shop. Being out of
   * time is a reason to stop listing, never a reason not to look.
   */
  const discoveryDeadline = Math.max(deadline, started + DISCOVERY_FLOOR_MS);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctx: AdapterContext = {
    fetchImpl,
    baseUrl,
    signal: opts.signal,
    onProgress: opts.onProgress,
    deadline: discoveryDeadline,
  };
  const warnings: string[] = [];
  // Declared up here because every early return reports through `done`.
  const stats = { pages: 0, bytes: 0 };

  const robots = await fetchRobots(ctx);
  if (robots.crawlDelayMs) warnings.push('This site asks readers to go slowly, so the preview is smaller');

  opts.onProgress?.({ stage: 'discovering', message: 'Looking for a shop' });
  const detection = await detectPlatform(ctx);
  const adapter = adapterFor(detection.platform);

  let discovered: Awaited<ReturnType<typeof adapter.discover>>;
  try {
    discovered = await adapter.discover(ctx);
  } catch {
    return done('blocked', [], [], 0, 'none', [...warnings, 'The product list could not be read']);
  }
  warnings.push(...discovered.warnings);

  // A store that asked us not to read something has not been argued with.
  const urls = discovered.productUrls.filter((u) => isAllowed(robots, u));
  const refused = discovered.productUrls.length - urls.length;
  if (refused > 0) warnings.push(`${refused} pages are disallowed by this site's robots.txt`);

  const fromApi = detection.platform !== 'generic' && !discovered.hints?.includes('json-blocked');
  const countSource: CountSource = urls.length === 0 ? 'none' : fromApi ? 'api' : 'sitemap';

  /** Evidence of a shop, as opposed to a platform that can host one. */
  const commerce = detection.signals.some((sig) => COMMERCE_SIGNALS.has(sig));

  if (urls.length === 0) {
    // A site we never identified as a shop, with nothing shop-shaped on it,
    // simply is not one. A storefront we *did* identify that yielded no list
    // is a different story, and the screen must not call it "no products".
    //
    // "Identified" has to mean commerce evidence, not a platform guess. The
    // Webflow detector matches the bare word "webflow" anywhere in a page, so
    // tailwindcss.com - which merely mentions it four times in its copy - came
    // back as a shop whose catalog we had failed to load. A site built with
    // Webflow is not a shop; one carrying `w-commerce` markup is.
    return done(commerce ? 'likely' : 'none', [], [], 0, countSource, warnings);
  }

  /**
   * The listing already told us, so do not go and ask again.
   *
   * A store with a bulk API hands over every product's name and pictures while
   * discovery is counting them. Reading two dozen product pages on top of that
   * bought a preview of data we already had in full, and the chooser then paid
   * one request per card for the rest of it. Measured on a 1,186 product store:
   * five requests brought the catalogue and drawing it cost another 1,186,
   * which is how cards came to sit blank and how the store came to refuse us.
   *
   * No pages, no preview, no per-card requests - and the whole catalogue on
   * screen instead of the first twenty-four.
   */
  const listed = discovered.cards ?? [];
  if (listed.length) {
    const byUrl = new Set(urls);
    const usable = listed.filter((c) => byUrl.has(c.url));
    const cards = usable.length ? usable : listed;
    opts.onProgress?.({ stage: 'discovering', discovered: cards.length, message: `Found ${cards.length} products` });
    return done('found', [], urls, urls.length || cards.length, countSource, warnings, cards);
  }

  opts.onProgress?.({ stage: 'discovering', discovered: urls.length, message: 'Reading a few products' });
  // Whatever discovery cost, the preview still gets its floor.
  const previewDeadline = Math.max(deadline, Date.now() + budget.previewFloorMs);
  const read = dedupeProducts(
    await fetchProductPages(ctx, urls, {
      want: budget.maxPreviewPages,
      stats,
      concurrency: budget.concurrency,
      maxBytes: budget.maxBytesPerPage,
      maxTotalBytes: budget.maxTotalBytes,
      delayMs: robots.crawlDelayMs,
      deadline: previewDeadline,
      onProduct: (fetched) => opts.onProgress?.({ stage: 'fetching_products', fetched, discovered: urls.length }),
    }),
  );
  // Requests in flight when the target is reached can carry it past the
  // preview size, and a preview of a settled size is worth more than the
  // extra card or two.
  const preview = read.slice(0, budget.maxPreviewPages);

  // URLs we could list but not read means a store that is there and shut to
  // us, which is worth saying plainly rather than reporting as an empty shop.
  //
  // Only when there was a store. This said `blocked` on the strength of the
  // addresses alone, and the addresses are a guess: the generic and Webflow
  // readers collect any link with the word "product" in it, so anthropic.com -
  // a company site with no shop anywhere on it - listed five and read none,
  // and the screen told its owner we could not load their catalogue. The same
  // evidence that separates "no shop" from "a shop we could not list" has to
  // separate "no shop" from "a shop we could not read".
  const verdict: CommerceVerdict = preview.length ? 'found' : commerce ? 'blocked' : 'none';
  return done(verdict, preview, urls, urls.length, countSource, warnings);

  function done(
    verdict: CommerceVerdict,
    candidates: ScanResult['candidates'],
    candidateUrls: string[],
    count: number,
    source: CountSource,
    notes: string[],
    cards: CatalogCard[] = [],
  ): ScanResult {
    return {
      baseUrl,
      platform: detection?.platform ?? 'unknown',
      signals: detection?.signals ?? [],
      verdict,
      count,
      cards,
      countSource: source,
      candidates,
      candidateUrls,
      truncated: count > candidates.length,
      warnings: notes,
      spent: { pages: stats.pages, bytes: stats.bytes, ms: Date.now() - started },
    };
  }
}
