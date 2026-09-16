import sharp from 'sharp';
import {
  discoverCatalog,
  mapPool,
  httpGet,
  normalizeStoreUrl,
  detectPlatform,
  adapterFor,
  imageFailure,
  summarise,
  shortfall,
  tally as countFailure,
  thrownFailure,
  type FailureTally,
  fetchProductPages,
  type CatalogProduct,
  type ImportStage,
  type JobProgress,
  type Platform,
} from '@scenri/catalog';
import { hostOf } from '@scenri/brand';
import type { Core } from '@scenri/core';

export interface CatalogImportDeps {
  core: Core;
  fetchImpl?: typeof fetch;
}

const running = new Map<string, { ctrl: AbortController; done: Promise<void> }>();

export function cancelCatalogImport(jobId: string): boolean {
  const job = running.get(jobId);
  if (!job) return false;
  job.ctrl.abort();
  return true;
}

/**
 * Stop every import and wait for it, before the database goes away.
 *
 * An import runs on its own after the request that started it has answered, so
 * a quit or a restart used to pull the database out from under one mid-write:
 * the next progress patch threw `The database connection is not open` with
 * nobody to catch it. Abort is the same path the cancel button takes, so the
 * job lands as stopped and keeps whatever it had saved.
 */
export async function settleCatalogImports(timeoutMs = 5000): Promise<void> {
  if (!running.size) return;
  for (const { ctrl } of running.values()) ctrl.abort();
  await Promise.race([
    Promise.allSettled([...running.values()].map((j) => j.done)),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
}

export interface StartImportOptions {
  /**
   * Import exactly these product pages instead of discovering a catalog.
   *
   * This is how a chosen set of candidates becomes products: the same job,
   * the same writer, no second path and no second model.
   */
  only?: string[];
}

/** Start an async catalog import job. Returns immediately with the job id. */
export function startCatalogImport(
  deps: CatalogImportDeps,
  brandId: string,
  url: string,
  opts: StartImportOptions = {},
): { jobId: string } {
  const { core } = deps;
  if (!core.store.getBrand(brandId)) throw Object.assign(new Error('brand not found'), { statusCode: 404 });

  let normalized: string;
  try {
    normalized = normalizeStoreUrl(url);
  } catch (err: any) {
    throw Object.assign(new Error(err?.message ?? 'invalid url'), { statusCode: 400 });
  }

  const job = core.catalog.createJob({ brandId, url: normalized });
  const ctrl = new AbortController();

  const done = runJob(deps, job.id, brandId, normalized, ctrl.signal, opts.only).finally(() => {
    running.delete(job.id);
  });
  // Held so `settleCatalogImports` can wait for it; the caller gets the id now.
  void done.catch(() => {});
  running.set(job.id, { ctrl, done });

  return { jobId: job.id };
}
/**
 * Discovery progress, written to the job row without flooding it.
 *
 * `updateJob` rewrites the whole row, and the adapters emit once per product,
 * so a 2,203-product store was 2,203 row writes. A stage change or a new
 * message is always worth recording; a bare count is worth it every tenth.
 * Progress never ends a job either: the pipeline reports `partial` mid-run
 * when a fetch fails and then carries on, and writing that through closed the
 * job where it stood. How a run ends is decided in one place, by `runJob`.
 */
function progressWriter(patch: (p: any) => unknown): (p: JobProgress) => void {
  let lastStage = '';
  let lastMessage: string | null = null;
  return (p: JobProgress) => {
    const reported = p.stage === 'queued' ? 'discovering' : p.stage;
    const stage: ImportStage = TERMINAL.has(reported) ? 'fetching_products' : reported;
    const message = p.message ?? null;
    const notable = stage !== lastStage || message !== lastMessage || p.fetched % 10 === 0;
    if (!notable) return;
    lastStage = stage;
    lastMessage = message;
    patch({
      stage,
      platform: p.platform,
      discovered: p.discovered,
      fetched: p.fetched,
      warnings: p.warnings,
      errors: p.errors,
      message,
    });
  };
}

/** What a stop says, which depends only on what it managed to keep. */
function stoppedMessage(saved: number): string {
  return saved ? `Stopped after saving ${saved.toLocaleString()} products` : 'Stopped before anything was saved';
}

async function runJob(
  deps: CatalogImportDeps,
  jobId: string,
  brandId: string,
  url: string,
  signal: AbortSignal,
  only?: string[],
): Promise<void> {
  const { core, fetchImpl } = deps;
  const patch = (p: Parameters<typeof core.catalog.updateJob>[1]) => core.catalog.updateJob(jobId, p);

  /**
   * Held outside the try so a stop that throws can still say what it saved.
   *
   * A cancel during the picture drain unwinds through the catch below, and
   * that path used to report "Stopped before anything was saved" whatever had
   * happened - measured on a real run that had already written 294 products
   * and 822 pictures.
   */
  const tally: Tally = { fetched: 0, upserted: 0, imagesDone: 0, imagesTotal: 0, errors: [], seenKeys: [] };

  try {
    // One path, whether someone ticked twelve products or asked for the whole
    // store. Both read product pages, and both have to write what they have
    // read before they have read everything: a 2,201-page store is minutes of
    // crawling, and holding all of it to persist at the end is what left the
    // Products page empty for the whole run and the heap carrying a catalogue
    // it was not using. The two differ in where the addresses come from and in
    // whether products missing from the run have genuinely gone.
    const ctx = { fetchImpl: fetchImpl ?? fetch, baseUrl: url, signal };

    let urls: string[] = [];
    /** A bulk API answered with the whole catalogue; there is nothing to crawl. */
    let bulk: CatalogProduct[] | null = null;
    let baseUrl: string;
    let platform: Platform;
    let discovered: number;
    let warnings: string[] = [];
    /** Only a full run may retire what the store no longer lists. */
    const sweep = !only?.length;

    if (only?.length) {
      // Re-crawling a store to find what someone just pointed at would be both
      // slower and ruder, so a chosen set skips discovery entirely.
      patch({ stage: 'fetching_products', message: `Importing ${only.length} products`, discovered: only.length });
      const detection = await detectPlatform(ctx);
      urls = only;
      baseUrl = url;
      platform = detection.platform;
      discovered = only.length;
      /**
       * Ask the listing before asking for pages.
       *
       * Twenty-five chosen products meant twenty-five page reads, and that is
       * the slow half of an import: measured on a real store, 25 products took
       * 7.2 s of which the pictures were a fraction. The same store answers its
       * whole listing in one request. The walk stops as soon as everything
       * chosen has been found, so a small pick costs one request and the whole
       * catalogue costs a handful.
       *
       * Whatever the listing did not carry still goes through the pages below,
       * so a handle the bulk API has forgotten is not simply lost.
       */
      const adapter = adapterFor(detection.platform);
      const listed = adapter.fetchSome ? await adapter.fetchSome({ ...ctx, baseUrl }, only) : null;
      if (listed?.length) {
        bulk = listed;
        const got = new Set(listed.map((p) => p.handle ?? '').filter(Boolean));
        urls = only.filter((u) => {
          const h = /\/products\/([^/?#]+)/i.exec(u)?.[1];
          return !h || !got.has(decodeURIComponent(h));
        });
      }
    } else {
      patch({ stage: 'discovering', message: 'Detecting store platform' });
      const found = await discoverCatalog({ url, fetchImpl, signal, onProgress: progressWriter(patch) });
      baseUrl = found.baseUrl;
      platform = found.detection.platform;
      discovered = found.estimatedTotal;
      warnings = found.progress.warnings;

      if (found.empty || !found.estimatedTotal) {
        const source = core.catalog.upsertSource(brandId, found.baseUrl, platform);
        patch({ sourceId: source.id, platform });
        // Two different outcomes, and they used to be the same one. Nothing
        // discoverable means there is no shop here, which is a fact about the
        // site and not a fault: a portfolio, an agency page or a company
        // homepage is a perfectly good brand source.
        patch({
          stage: 'no_catalog',
          errors: [],
          warnings: found.progress.warnings,
          message: 'No shop found on this site',
          finished: true,
        });
        core.catalog.setSourceStatus(source.id, 'empty', true);
        return;
      }

      if (!found.byPage) {
        // A platform answering its own bulk API: shopify, woocommerce,
        // webflow. That is a handful of paged requests and already bounded, so
        // it stays one round. A Shopify store that refuses `products.json` is
        // NOT this case - it comes back as a wall of pages, and takes the
        // batched crawl below, which is the case this was all written for.
        const products = await found.fetchAll();
        if (signal.aborted) {
          patch({ stage: 'cancelled', errors: [], message: stoppedMessage(tally.upserted), finished: true });
          return;
        }
        if (!products.length) {
          const source = core.catalog.upsertSource(brandId, baseUrl, platform);
          patch({ sourceId: source.id, platform });
          patch({
            stage: 'failed',
            errors: found.progress.errors,
            warnings: found.progress.warnings,
            message: found.progress.errors[0]?.message ?? 'No products imported',
            finished: true,
          });
          core.catalog.setSourceStatus(source.id, 'failed', true);
          return;
        }
        // Written one at a time through the same writer as a crawl, with the
        // same picture drain beside it: the catalogue arrived in one answer,
        // but it still reaches the screen steadily rather than all at once
        // after every picture has downloaded.
        bulk = products;
        discovered = found.progress.discovered;
        warnings = found.progress.warnings;
      }
      if (!bulk) {
        urls = found.productUrls;
        patch({ stage: 'fetching_products', discovered, message: `Reading ${discovered.toLocaleString()} products` });
      }
    }

    const run = beginWrite(deps, jobId, brandId, baseUrl, platform, tally, discovered);
    const pictures = drainPictures(deps, jobId, brandId, tally, signal, hostOf(baseUrl));

    // A product goes in the moment its page parsed, and its pictures start
    // downloading beside the crawl rather than after it.
    //
    // This read twenty-five pages, wrote twenty-five rows, then stopped
    // everything to fetch their pictures before reading the next twenty-five.
    // The wall jumped twenty-five at a time and then sat still, which is a
    // worse thing to watch than the same work arriving steadily, and the
    // download pool spent half the import idle waiting on the crawl.
    let pictureErrors: unknown[];
    let pictureReasons: FailureTally = {};
    // What the crawl really spent, so a shop that stops answering can be told
    // apart from a shop with very few products.
    const stats = { pages: 0, bytes: 0, refused: 0, reasons: {} as FailureTally };
    try {
      // Not either/or any more: a chosen set can come partly from the listing
      // and partly from the pages the listing did not carry.
      if (bulk) for (const p of bulk) run.write(p);
      if (urls.length)
        await fetchProductPages(ctx, urls, {
          concurrency: IMPORT_CONCURRENCY,
          maxBytes: 1_500_000,
          onEach: run.write,
          stats,
          // A run that cannot finish still has to end. Generous enough for a
          // 2,200 page catalogue, which measures around sixteen minutes, and
          // short of the forever this had before. Stopping here leaves the run
          // `partial` with what it saved, never `completed`.
          deadline: Date.now() + IMPORT_DEADLINE_MS,
          // Past this many refusals in a row the store is not going to change
          // its mind inside this import, and waiting out its cooldown for the
          // rest of the catalogue is time nobody gets a product for.
          giveUpAfterRefusals: 24,
        });
      if (!signal.aborted && tally.upserted) {
        patch({
          stage: 'processing_assets',
          message: `Downloading ${tally.imagesTotal.toLocaleString()} pictures`,
          upserted: tally.upserted,
          fetched: tally.fetched,
        });
      }
    } finally {
      // No more products are coming, whether the crawl ended or threw. Without
      // this a throw left the drain looping and writing for ever.
      pictures.stop();
      const settled = await pictures.done;
      pictureErrors = settled.errors;
      pictureReasons = settled.reasons;
    }

    if (signal.aborted) {
      // Stopping mid-crawl is not a fault of the site's, and what was already
      // written stays written.
      patch({
        stage: 'cancelled',
        errors: [],
        message: stoppedMessage(tally.upserted),
        finished: true,
      });
      core.catalog.setSourceStatus(run.sourceId, 'partial', true);
      return;
    }

    run.finish({
      sweep,
      warnings,
      errors: pictureErrors,
      refused: stats.refused,
      reasons: { ...stats.reasons, ...pictureReasons },
      // A chosen set can now come partly from the listing and partly from the
      // pages it did not carry, so both halves count.
      asked: (bulk?.length ?? 0) + urls.length,
      // Addresses that actually yielded a page, which is the unit the person's
      // question was asked in. Products are the wrong unit: one address can
      // carry several, and counting them made a run that lost three addresses
      // report that it had lost one. A listing answers for itself.
      worked: (bulk?.length ?? 0) + Math.max(0, stats.pages - stats.refused),
      // Every address was read. A bulk API hands its share over whole, so only
      // the pages left over have to be covered.
      covered: stats.pages >= urls.length,
    });
  } catch (err: any) {
    // Stopping during discovery throws out of the pipeline, and the throw is
    // the stop rather than a fault of the site's.
    if (signal.aborted) {
      patch({ stage: 'cancelled', errors: [], message: stoppedMessage(tally.upserted), finished: true });
      return;
    }
    patch({
      stage: 'failed',
      message: String(err?.message ?? err),
      errors: [{ code: 'import_failed', message: String(err?.message ?? err) }],
      finished: true,
    });
  }
}

/**
 * How many pictures of one product are worth keeping on this machine.
 *
 * Measured on gymshark.com: a product page offers about eleven images, and
 * Scenri re-encodes each to PNG, which turns a 262 KB source JPEG into 2.8 MB.
 * The whole catalog at eleven each is 24,233 images and roughly 70 GB. Three
 * is a front, a back and a detail - enough to recognise and to shoot with -
 * and the rest of the URLs stay recorded, so a product can be filled out later
 * without crawling the store again.
 */
export const IMAGES_PER_PRODUCT = 3;

/**
 * Products read and written per round of a chosen import.
 *
 * Small enough that the first ones appear within a few seconds of a large
 * store, big enough that the per-batch bookkeeping is not the cost.
 */
/** Stages that mean a job is over. Only `runJob` may write one. */
const TERMINAL: ReadonlySet<string> = new Set(['completed', 'partial', 'no_catalog', 'cancelled', 'failed']);

/**
 * How many pictures are downloaded at once.
 *
 * Four, and like the page rate this is about the shop rather than the clock.
 *
 * A fixture sweep made twelve look obviously right: 600 pictures behind a
 * 120 ms delay took 20.9 s at six and 11.0 at twelve, flat by sixteen. A
 * fixture has no bot check. Against gymshark.com the pictures are requested
 * from the same host as the pages, so the real budget was four page reads plus
 * twelve picture downloads - sixteen at once, sustained - and the run was shut
 * out twice.
 *
 * Four and four is eight, near a browser's own per-host ceiling, and the
 * latency it costs is hidden by asking early rather than by asking harder.
 */
const IMAGE_CONCURRENCY = 4;

/**
 * The same question, for a store whose pictures live somewhere else.
 *
 * The four above is a budget against one host: on gymshark.com the pictures
 * come from the storefront itself, so four page reads and four downloads is
 * eight at once to a single server, and sixteen got the run shut out twice.
 *
 * Most storefronts are not that shape. Shopify serves every picture from
 * `cdn.shopify.com`, which is a different host from the shop and a CDN rather
 * than an application - so while the pictures are downloading, the storefront
 * is being asked for nothing at all, and the four-per-host budget it was owed
 * is being spent on a server that never sees it.
 *
 * Twelve is the number the original fixture sweep already found: 600 pictures
 * behind a 120 ms delay took 20.9 s at six, 11.0 s at twelve, and were flat by
 * sixteen. It applies only when every picture in the round is off-host, and
 * the shared host cooldown still answers for us if the CDN disagrees.
 */
const IMAGE_CONCURRENCY_OFF_HOST = 12;

/** Whether nothing in this round would touch the shop itself. */
function allOffHost(round: { sourceUrl: string }[], storeHost: string): boolean {
  if (!storeHost || !round.length) return false;
  return round.every((img) => {
    const h = hostOf(img.sourceUrl);
    return h !== '' && h !== storeHost;
  });
}

/**
 * What a job has done so far, across however many batches it takes.
 *
 * A 2,200-product store is about sixteen minutes of reading, and the old shape
 * fetched every page before writing a single row - so the task said "0 of
 * 2,199" for the whole of it and nothing appeared on the products page until
 * the end. Batches share this, and each one writes.
 */
interface Tally {
  fetched: number;
  upserted: number;
  imagesDone: number;
  imagesTotal: number;
  errors: unknown[];
  /**
   * Every external key this run has written, across all of its batches.
   *
   * A full catalog run retires what the store no longer lists, and it now
   * writes in batches: sweeping on one batch's keys alone would mark the whole
   * rest of the catalogue as gone. So the keys accumulate and the sweep waits
   * for the last batch.
   */
  seenKeys: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The writer for one import: rows in, one product at a time.
 *
 * `upsertProduct` is the only writer of catalog rows on this path, and it is
 * called the moment a product's page has been parsed rather than once a batch
 * of them has. Nothing is held: a store of any size costs one product of
 * memory here.
 */
function beginWrite(
  deps: CatalogImportDeps,
  jobId: string,
  brandId: string,
  baseUrl: string,
  platform: Platform,
  tally: Tally,
  discovered: number,
) {
  const { core } = deps;
  const patch = (p: Parameters<typeof core.catalog.updateJob>[1]) => core.catalog.updateJob(jobId, p);
  const source = core.catalog.upsertSource(brandId, baseUrl, platform);
  patch({ sourceId: source.id, platform });
  core.catalog.setSourceStatus(source.id, 'importing');

  return {
    sourceId: source.id,
    write(p: CatalogProduct) {
      core.catalog.upsertProduct({
        sourceId: source.id,
        brandId,
        externalKey: p.externalKey,
        title: p.title,
        descriptionHtml: p.descriptionHtml,
        url: p.url,
        handle: p.handle,
        vendor: p.vendor,
        productType: p.productType,
        tags: p.tags,
        category: p.category,
        price: p.price,
        compareAtPrice: p.compareAtPrice,
        currency: p.currency,
        available: p.available,
        // `raw` is the whole crawled payload, 14.2 KB a product on gymshark
        // and 32 MB across its catalog, written to sqlite and read by nothing.
        raw: null,
        variants: p.variants,
        images: (p.images ?? []).map((img) => ({
          sourceUrl: img.url,
          position: img.position,
          width: img.width,
          height: img.height,
          alt: img.alt,
        })),
        collections: (p.collections ?? []).map((c) => ({ externalKey: c, title: c })),
      });
      tally.seenKeys.push(p.externalKey);
      tally.upserted++;
      tally.fetched++;
      // Every product, not every fifth.
      //
      // `updateJob` rewrites the whole row, so this was throttled - and the
      // dialog then counted in steps of five, which is what a one-at-a-time
      // import looked like from the outside. Measured: 2,201 of these row
      // writes take 115 ms in total, 52 microseconds each, against a WAL
      // database. That is noise across a two-minute import, and it is the
      // difference between watching an import and watching a counter tick.
      patch({ upserted: tally.upserted, fetched: tally.fetched });
    },
    finish({
      sweep,
      warnings,
      errors,
      refused = 0,
      covered = true,
      reasons = {},
      asked = 0,
      worked,
    }: {
      covered?: boolean;
      sweep: boolean;
      warnings: string[];
      errors: unknown[];
      refused?: number;
      /** What went wrong and how often, for the sentence a person reads. */
      reasons?: FailureTally;
      /** How many products this run set out to save. */
      asked?: number;
      /** How many of those addresses actually answered with a page. */
      worked?: number;
    }) {
      /**
       * Retire what the store no longer lists - but only from a run entitled
       * to say so.
       *
       * `markMissingUnavailable` marks every key this run did not write, and
       * with no keys at all it marks the whole source. A full re-import that a
       * rate limiter cut down to seventeen products would therefore hide the
       * eleven hundred a previous run had imported perfectly well, and the
       * library filters `unavailable` out, so they simply vanish. A run that
       * was refused pages does not know what is gone; it only knows what it
       * was allowed to read.
       *
       * So: every address covered, nothing refused, something saved.
       */
      const mayRetire = sweep && covered && refused === 0 && tally.upserted > 0;
      if (mayRetire) core.catalog.markMissingUnavailable(source.id, tally.seenKeys);
      // Only knowable once the run has seen every product: a picture is shop
      // furniture when it belongs to lots of them. Hidden, not deleted.
      if (tally.upserted > 0) core.catalog.excludeSharedImages(source.id);
      tally.errors = errors;
      /**
       * Partial means the catalogue was not read, not that a picture failed.
       *
       * This compared products saved against addresses discovered, and a store
       * lists several addresses for one product - gymshark.com's 2,206 URLs are
       * 1,052 products, because a colourway is an address and `ProductGroup` is
       * one product. So a run that read every address it was given, saved
       * every product behind them and lost two pictures out of 1,909 called
       * itself partial. Reading every address is the thing worth asserting;
       * failed pictures are recorded as errors and show on the card.
       */
      const partial = !covered || refused > 0;
      /**
       * Nothing saved is a failure, whatever else is true.
       *
       * This was reachable as `completed`: a store behind a rate limiter
       * answered 429 to every page, the crawl read each one as a page with no
       * product on it, and the job ended saying it had imported zero products.
       * The user was told their products were found and then handed silence.
       * A run that saved nothing has failed, and the reason goes with it.
       */
      const savedNothing = tally.upserted === 0;
      const total = asked || discovered || tally.fetched;
      const said = summarise(
        reasons,
        tally.upserted,
        total,
        worked === undefined ? undefined : shortfall(total, worked),
      );
      const stage: ImportStage = savedNothing ? 'failed' : partial ? 'partial' : 'completed';
      const message = savedNothing
        ? (said ?? 'We found the products on this site, but none of them could be imported.')
        : (said ??
          (partial
            ? `Imported ${tally.upserted.toLocaleString()} products with ${(errors.length + refused).toLocaleString()} issue${errors.length + refused === 1 ? '' : 's'}`
            : `Imported ${tally.upserted.toLocaleString()} products`));
      patch({
        stage,
        upserted: tally.upserted,
        fetched: tally.fetched,
        imagesDone: tally.imagesDone,
        imagesTotal: tally.imagesTotal,
        errors,
        warnings,
        message,
        finished: true,
      });
      core.catalog.setSourceStatus(source.id, savedNothing ? 'failed' : partial ? 'partial' : 'ready', true);
    },
  };
}

/**
 * Product pages read at once during an import.
 *
 * Four, and this number is about the shop rather than about us.
 *
 * A burst benchmark said otherwise and it was wrong. Sixteen warmed
 * gymshark.com pages measured 300 ms each at four and 86 at twelve, with every
 * product and every variant coming back at both, so twelve looked free. It is
 * not free over a whole catalogue: twelve page reads alongside twelve picture
 * downloads, sustained, tripped gymshark's WAF after about 413 products and
 * seventy-five seconds. Every request after that answered HTTP 405 with
 * `x-amzn-waf-action: captcha`, so the run ended having read 413 of 2,207 and
 * the site stayed shut to us for some time afterwards.
 *
 * Four is the rate a real 1,020-page run had already sustained without being
 * challenged. A burst of sixteen is not evidence about an hour of crawling,
 * and the only honest test of a limit like this is the long one.
 */
const IMPORT_CONCURRENCY = 4;

/**
 * The longest one crawl may run before it reports what it has.
 *
 * Measured: gymshark's 2,201 pages take about sixteen minutes at four wide, so
 * forty leaves room for a slower store of the same size without leaving a job
 * that can run all day. Reaching it is a `partial`, with every product already
 * saved kept.
 */
const IMPORT_DEADLINE_MS = 40 * 60_000;

/** A round of pictures to ask for at once. Small, because more are arriving. */
const PICTURE_ROUND = 60;

/**
 * Pictures, downloaded continuously beside the crawl until nothing is left.
 *
 * Rows come back ordered by position, so every product gets the picture its
 * card draws before any product gets its second: the wall fills with real
 * thumbnails as it grows rather than in a second pass at the end.
 *
 * Capped on the image's own position rather than by counting as we go. A
 * running count is per call, so a later round saw the pictures an earlier one
 * had deliberately skipped as fresh work and fetched them - forty products
 * asked for 170 pictures instead of 120. Position is a fact about the image,
 * so it says the same thing on every round and on every re-import.
 */
function drainPictures(
  deps: CatalogImportDeps,
  jobId: string,
  brandId: string,
  tally: Tally,
  signal: AbortSignal,
  /** The shop's own host, so a round that never touches it can go faster. */
  storeHost = '',
  imagesPerProduct = IMAGES_PER_PRODUCT,
): { stop(): void; done: Promise<{ errors: unknown[]; reasons: FailureTally }> } {
  const { core, fetchImpl } = deps;
  const patch = (p: Parameters<typeof core.catalog.updateJob>[1]) => core.catalog.updateJob(jobId, p);
  const errors = [...(core.catalog.getJob(jobId)?.errors ?? [])] as any[];
  const reasons: FailureTally = {};
  let stopped = false;

  const done = (async () => {
    while (!signal.aborted) {
      const round = core.catalog
        .listImagesNeedingAssets(brandId, PICTURE_ROUND)
        .filter((img) => img.position < imagesPerProduct);
      if (!round.length) {
        if (stopped) break;
        // Nothing to do yet: the crawl is still turning up products.
        await sleep(150);
        continue;
      }
      /**
       * The real total, not the rounds fetched so far.
       *
       * This was `+= round.length`, which made the total mean "pictures we
       * have got round to looking at" - it grew by sixty every round and the
       * fraction fell back every time: 60/60, then 64/120, then 122/172, a bar
       * sliding backwards twice while nothing had gone wrong. What is owed is
       * one count, and while products are still being written it grows the way
       * the work actually grows rather than in steps of sixty.
       */
      tally.imagesTotal = tally.imagesDone + core.catalog.countImagesNeedingAssets(brandId, imagesPerProduct);
      await mapPool(
        round,
        allOffHost(round, storeHost) ? IMAGE_CONCURRENCY_OFF_HOST : IMAGE_CONCURRENCY,
        async (img) => {
          if (signal.aborted) return;
          try {
            const res = await httpGet(img.sourceUrl, { fetchImpl, signal, timeoutMs: 40_000, retries: 2 });
            if (!res.ok) {
              errors.push({ code: 'image_http', message: `HTTP ${res.status}`, url: img.sourceUrl });
              countFailure(reasons, imageFailure(res.status));
              return;
            }
            const buf = Buffer.from(await res.arrayBuffer());
            if (!buf.length) {
              errors.push({ code: 'image_empty', message: 'Empty image', url: img.sourceUrl });
              countFailure(reasons, 'IMAGE_EMPTY');
              return;
            }
            // Keep the bytes the store served.
            //
            // This re-encoded every picture to PNG, which turned a 269 KB jpeg
            // into 2.90 MB: gymshark's 6,603 pictures were 19.1 GB on disk and
            // 1.9 minutes of encoding, for a format nothing asks for. Display
            // reads the WebP thumbnail derivative and generation reads the file
            // through sharp, which sniffs whatever it finds.
            //
            // `metadata()` is also the validation: bytes that are not a picture
            // throw here, exactly as the decode used to.
            const probe = await sharp(buf).metadata();
            // A picture the library could never show is worse than no picture:
            // it is a product that looks imported pointing at a 404. The image
            // store serves a fixed set of raster types, so a vector saved here
            // resolved to a `.png` that was never written. Sharp reads SVG
            // happily, which is exactly why this has to be refused by name.
            if (probe.format === 'svg') {
              errors.push({ code: 'image_unsupported', message: 'Not a photograph', url: img.sourceUrl });
              countFailure(reasons, 'UNSUPPORTED_MEDIA');
              return;
            }
            const turned = (probe.orientation ?? 1) > 1;
            // The one case worth paying for: an EXIF-rotated photograph looks
            // wrong everywhere if the bytes are kept as they are.
            const keep = turned ? await sharp(buf).rotate().toBuffer() : buf;
            const meta = turned ? await sharp(keep).metadata() : probe;
            const hash = core.images.save(keep, meta.format ?? probe.format ?? 'png');
            core.catalog.setImageAsset(img.productId, img.sourceUrl, `asset:${hash}`, {
              width: meta.width,
              height: meta.height,
            });
          } catch (err: any) {
            if (signal.aborted) return;
            countFailure(reasons, thrownFailure(err, signal.aborted));
            errors.push({
              code: 'image_failed',
              message: String(err?.message ?? err),
              url: img.sourceUrl,
              retryable: true,
            });
          } finally {
            tally.imagesDone++;
            patch({ imagesDone: tally.imagesDone, imagesTotal: tally.imagesTotal, errors });
          }
        },
        signal,
      );
      // A row that keeps failing would come back in the next round for ever.
      // `setImageAsset` is what takes one out of the list, so anything still
      // here after its turn is a picture this run could not get.
      const stuck = core.catalog
        .listImagesNeedingAssets(brandId, PICTURE_ROUND)
        .filter((img) => img.position < imagesPerProduct);
      if (stuck.length && stuck[0]?.id === round[0]?.id) {
        errors.push({ code: 'images_stalled', message: 'Some pictures could not be downloaded' });
        break;
      }
    }
    patch({ imagesDone: tally.imagesDone, imagesTotal: tally.imagesTotal, errors });
    return { errors, reasons };
  })();

  return {
    stop() {
      stopped = true;
    },
    done,
  };
}

/** Resolve a library product id (manual or cat-*) into generation-friendly shape. */
export function resolveLibraryProduct(
  core: Core,
  brandId: string,
  productId: string,
): {
  id: string;
  name: string;
  shots: { file: string; locked?: boolean }[];
} | null {
  const brand = core.store.getBrand(brandId);
  if (!brand) return null;
  const library = core.catalog.listLibraryProducts(brandId, brand.json);
  return library.find((p) => p.id === productId) ?? null;
}

/** The store's HTML description, flattened to prompt-safe prose. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The opening sentence, or a clean truncation when the first one runs long. */
function firstSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const stop = text.slice(0, max + 1).search(/[.!?](\s|$)/);
  if (stop > 40) return text.slice(0, stop + 1);
  const cut = text.lastIndexOf(' ', max);
  return `${text.slice(0, cut > 40 ? cut : max).trimEnd()}\u2026`;
}

/**
 * The distinct colour names a product's variants declare, in store order.
 * Only meaningful from two up: one colour is not a colorway story, and a
 * store with no colour option contributes nothing.
 */
function colorwaysOf(variants: { options?: Record<string, string> }[] | undefined): string[] {
  const seen: string[] = [];
  for (const v of variants ?? []) {
    const key = Object.keys(v.options ?? {}).find((k) => /colou?r/i.test(k));
    const val = key ? String((v.options as Record<string, string>)[key]).trim() : '';
    if (val && !seen.includes(val)) seen.push(val);
    if (seen.length >= 12) break;
  }
  return seen.length >= 2 ? seen : [];
}

export function brandJsonWithCatalogProducts(core: Core, brandId: string): any {
  const brand = core.store.getBrand(brandId);
  if (!brand) return null;
  const json = { ...(brand.json as any) };
  const library = core.catalog.listLibraryProducts(brandId, brand.json);
  // Present catalog + manual as products[] for brief compilation
  json.products = library.map((p) => {
    const colorways = colorwaysOf((p as any).variants);
    return {
      id: p.id,
      name: p.name,
      shots: p.shots,
      notes: p.url ?? undefined,
      // Forwarded so the compiler can state real-world material and size. These
      // were dropped here, which is part of why a watch could render plate-sized:
      // nothing downstream ever knew how big the object actually is.
      ...(p.category ? { category: p.category } : {}),
      ...(p.variant ? { variant: p.variant } : {}),
      ...(p.material ? { material: p.material } : {}),
      ...(p.dimensions ? { dimensions: p.dimensions } : {}),
      // The store's own words, the way the 0.6.9 fix gave demo products
      // theirs: the description is what anchors scale when dimensions are
      // absent, and imported products shipped with neither.
      ...((p as any).descriptionHtml
        ? { description: firstSentence(stripHtml(String((p as any).descriptionHtml)), 300) }
        : {}),
      // The declared colorways, so the compiler can say a colour difference
      // between references is a colorway rather than lighting.
      ...(colorways.length ? { colorways } : {}),
    };
  });
  return json;
}

/** How many imports are mid-flight — the update path refuses to restart over one. */
export function runningImportCount(): number {
  return running.size;
}
