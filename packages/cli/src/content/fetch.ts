import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, existsSync, readFileSync, lstatSync, unlinkSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import JSZip from 'jszip';
import pinV3 from './archive-v3.json' with { type: 'json' };
import {
  contentCacheReady,
  contentCacheRoot,
  contentCacheVersion,
  contentPartialRoot,
  installedContentRoot,
} from './overlay.js';
import { type ArchivePin, installByRange, type PinnedFile } from './ranged.js';

/**
 * The library download: the npm package carries every catalog entry, the
 * scene and presenter cards and the starter wall; the heavy imagery
 * (reference galleries, the rest of the showcase heroes, product shots,
 * presenter identity sets) arrives once from a versioned archive and is
 * cached under ~/.scenri/content. Same manners as the update check: said once
 * in the console, silent offline, opt-out-able (SCENRI_NO_CONTENT_FETCH=1),
 * URL overridable for forks and airgaps (SCENRI_CONTENT_URL).
 *
 * The pinned archive is read by byte range, a file at a time, Home's pictures
 * first (ranged.ts), each checked against its own hash in the pin before it
 * is kept; an archive with no pin that applies, or a host that does not
 * answer ranges, is taken whole as before (installContentArchive).
 */

/**
 * The archive this build expects. A cache older than CONTENT_VERSION is
 * replaced on the next launch, so a catalog that now names new pictures never
 * runs against the pictures of an older library. CI and the publish job
 * download the same tag (contentVersion.test.ts keeps them in step).
 */
export const CONTENT_VERSION = 3;
export const CONTENT_TAG = 'content-v3';
/**
 * The sha256 of the content-v3 release asset, checked before anything is
 * unpacked. A release asset can be replaced on GitHub; a build installs only
 * the bytes it was released against. A custom SCENRI_CONTENT_URL is its
 * owner's choice and is not pinned. Changes together with CONTENT_TAG, read
 * from the published asset.
 */
export const CONTENT_SHA256 = 'c736f1f9142bc428e19bb80bc139c2d9e60a9dce7449b322760ffe8df333b734';

/** The published content-v3 archive, file by file (scripts/pin-content.mts). */
export const CONTENT_PIN = pinV3 as ArchivePin;

export function archiveMatches(bytes: Buffer, expected: string = CONTENT_SHA256): boolean {
  return createHash('sha256').update(bytes).digest('hex') === expected;
}

const DEFAULT_CONTENT_URL = `https://github.com/tonygorb/scenri/releases/download/${CONTENT_TAG}/scenri-content.zip`;
// The whole download, headers through last byte: ~155 MB inside it needs about 0.7 Mbps, and a
// socket that goes quiet is still cut off rather than held for the life of the process.
const TIMEOUT_MS = 30 * 60 * 1000;

export function resolveContentUrl(env: Record<string, string | undefined> = process.env, override?: string): string {
  return override ?? env.SCENRI_CONTENT_URL ?? DEFAULT_CONTENT_URL;
}

/**
 * True when the cache is missing, or older than this build expects. A custom
 * archive (SCENRI_CONTENT_URL, a fork or an airgap) is never second-guessed:
 * its owner decides when it changes.
 */
export function contentCacheStale(
  env: Record<string, string | undefined> = process.env,
  custom = Boolean(env.SCENRI_CONTENT_URL),
): boolean {
  if (!contentCacheReady(env)) return true;
  return !custom && contentCacheVersion(env) < CONTENT_VERSION;
}

/**
 * Unpack an archive into `root` through a staging directory: zip-slip guard,
 * meta.json as the completeness marker, then one swap. Returns why it refused,
 * or null once the new library is in place. Shared with pull-content.mts.
 */
export async function installContentArchive(zipBytes: Buffer, root: string): Promise<string | null> {
  const staging = `${root}.staging`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    const zip = await JSZip.loadAsync(zipBytes);
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      // zip-slip guard: nothing may escape the staging directory
      const rel = normalize(name);
      if (rel.startsWith('..') || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) continue;
      const dest = join(staging, rel);
      mkdirSync(dirname(dest), { recursive: true });
      await writeFile(dest, await entry.async('nodebuffer'));
    }
    // meta.json doubles as the completeness marker overlay.ts keys on, so a
    // half-written cache is never preferred over the bundled starter.
    if (!existsSync(join(staging, 'meta.json'))) {
      rmSync(staging, { recursive: true, force: true });
      return 'archive carries no meta.json';
    }
    removeRoot(root);
    renameSync(staging, root);
    return null;
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}

/**
 * A worktree's lane home links content/ to the primary's cache
 * (worktree.ts shareContent). Replacing it drops the link; it never empties
 * the library the link points at.
 */
function removeRoot(root: string): void {
  let link = false;
  try {
    link = lstatSync(root).isSymbolicLink();
  } catch {
    return; // nothing there yet
  }
  if (link) unlinkSync(root);
  else rmSync(root, { recursive: true, force: true });
}

/**
 * At start, before anything is served: a download that finished last time in
 * content.partial is moved into place. Never while the server runs, where a
 * picture being read or a derivative being cut could lose its file mid-way.
 * If the move fails (a Windows lock), the complete partial keeps serving as
 * the installed library and the next start tries again.
 */
export function finishContentInstall(env: Record<string, string | undefined> = process.env): 'moved' | 'kept' | 'none' {
  const root = contentCacheRoot(env);
  const partial = contentPartialRoot(env);
  if (installedContentRoot(env) !== partial) return 'none';
  const aside = `${root}.old`;
  try {
    rmSync(aside, { recursive: true, force: true, maxRetries: 3 });
    let link = false;
    try {
      link = lstatSync(root).isSymbolicLink();
    } catch {
      /* no cache yet */
    }
    if (link) unlinkSync(root);
    else if (existsSync(root)) renameSync(root, aside);
    renameSync(partial, root);
  } catch {
    return 'kept';
  }
  // the old library goes once the server is up, off the path of the first requests
  setTimeout(() => rmSync(aside, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }), 2000).unref();
  return 'moved';
}

interface SettingsLike {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
}

export interface ContentFetchResult {
  ok: boolean;
  /** true when this call actually installed a fresh cache. */
  updated: boolean;
  error: string | null;
}

/**
 * What the studio can be told about the library download, and all it needs:
 * whether pictures are still on their way, how many have arrived of how many,
 * how the run ended, and a count that moves when a whole library installs.
 * Both totals are known from the pin, so a count and a share are the truth.
 */
export interface ContentState {
  /**
   * Library pictures are on their way: the download is on, the library is not
   * the one this version wants, and this start has not finished trying. True
   * from the first moment, before the attempt starts, so a studio that asks
   * early waits for it; false once the run ends, so nothing waits forever.
   */
  arriving: boolean;
  /** Installs this process has made. A change means generation has a library it lacked. */
  installs: number;
  /** Pictures on disk and checked, of the pictures in the archive. */
  landed: number;
  total: number;
  /** Packed bytes on disk and checked, of the archive's; the fill of the Activity ring. */
  bytes: number;
  totalBytes: number;
  /** Pictures that did not arrive in a run that ended. */
  failed: number;
  /** How this start's run ended: every file ('complete'), or some did not arrive ('partial'). Null while it runs. */
  outcome: 'complete' | 'partial' | null;
  /** When this start began the download, for the Activity clock. */
  startedAt: string | null;
}

export interface ContentFetcher {
  enabled(): boolean;
  ensure(): Promise<ContentFetchResult>;
  /** One run shortly after listen. Timer unref'd: never keeps the process alive. */
  schedule(): void;
  state(): ContentState;
  /** Stop what is in flight (Shut down): what landed stays, the next start resumes the rest. */
  settle(): Promise<void>;
}

const isPicture = (f: PinnedFile) => f[0].endsWith('.jpg');
const benchNumber = (raw: string | undefined, min: number, max: number) => {
  const n = Number(raw);
  return raw && Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : undefined;
};

export function createContentFetcher(deps: {
  store: SettingsLike;
  fetchImpl?: typeof fetch;
  url?: string;
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
  /** The whole-archive download's bound, headers through last byte; tests shorten it. */
  timeoutMs?: number;
  /** The archive's expected sha256; CONTENT_SHA256 unless the URL is custom. */
  sha256?: string | null;
  /** The file-by-file pin; the built-in one for the release, SCENRI_CONTENT_PIN or a mirror's size match for a custom URL. */
  pin?: ArchivePin | null;
  /** Library files to fetch first, most wanted first (priority.ts); the rest follow in archive order. */
  priority?: () => readonly string[];
  concurrency?: number;
  capBytes?: number;
  idleMs?: number;
  backoffMs?: readonly number[];
  /** How long a run that ended partial waits before its one more pass. */
  retryAfterMs?: number;
}): ContentFetcher {
  const env = deps.env ?? process.env;
  const log = deps.log ?? console.log;
  const doFetch = deps.fetchImpl ?? fetch;
  const url = resolveContentUrl(env, deps.url);
  const custom = Boolean(deps.url ?? env.SCENRI_CONTENT_URL);
  const expected = deps.sha256 !== undefined ? deps.sha256 : custom ? null : CONTENT_SHA256;
  const pin = (() => {
    if (deps.pin !== undefined) return deps.pin;
    if (custom && env.SCENRI_CONTENT_PIN) {
      try {
        return JSON.parse(readFileSync(env.SCENRI_CONTENT_PIN, 'utf8')) as ArchivePin;
      } catch {
        return null;
      }
    }
    // The release, or a mirror of it: the probe refuses a host whose archive is not this size.
    return CONTENT_PIN;
  })();

  const enabled = () => env.SCENRI_NO_CONTENT_FETCH !== '1' && deps.store.getSetting('content.enabled') !== 'false';

  let inflight: Promise<ContentFetchResult> | null = null;
  // What the studio is told. Whether the library is stale is read once and
  // again after each run, not on every poll.
  let gaveUp = false;
  let installs = 0;
  let stale: boolean | null = null;
  let startedAt: string | null = null;
  let outcome: ContentState['outcome'] = null;
  let failed = 0;
  const landedNames = new Set<string>();
  let landedPictures = 0;
  let landedBytes = 0;
  const totals = pin
    ? { total: pin.files.filter(isPicture).length, totalBytes: pin.files.reduce((sum, f) => sum + f[2], 0) }
    : { total: 0, totalBytes: 0 };
  const stop = new AbortController();

  const disclose = () => {
    if (deps.store.getSetting('content.disclosed')) return;
    // Same doctrine as the update check: the app's self-initiated requests
    // announce themselves once, with the off switch in the same breath.
    log('  fetching the Scenri library (~155 MB, once, cached; set SCENRI_NO_CONTENT_FETCH=1 to disable)');
    deps.store.setSetting('content.disclosed', '1');
  };

  async function download(): Promise<ContentFetchResult> {
    const root = contentCacheRoot(env);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? TIMEOUT_MS);
      if (typeof timer === 'object') timer.unref?.();
      // The bytes are read inside the timer, and the signal aborts the body as
      // well as the request: a server that sends headers and then goes quiet
      // would otherwise hold this download, and every ensure() waiting on it,
      // for as long as the process lives.
      let bytes: Buffer;
      try {
        const res = await doFetch(url, { signal: ctrl.signal });
        if (!res.ok) return { ok: false, updated: false, error: `archive answered ${res.status}` };
        bytes = Buffer.from(await res.arrayBuffer());
      } finally {
        clearTimeout(timer);
      }
      // A failed download or a refused archive leaves the old cache serving.
      if (expected && !archiveMatches(bytes, expected)) {
        return {
          ok: false,
          updated: false,
          error: 'the library download does not match the archive this version expects',
        };
      }
      const refused = await installContentArchive(bytes, root);
      if (refused) return { ok: false, updated: false, error: refused };
      return { ok: true, updated: true, error: null };
    } catch (err) {
      // Offline is a non-event: the bundled catalog and thumbnails carry the
      // app (or the older cache does), and the next launch simply tries again.
      return { ok: false, updated: false, error: String((err as Error)?.message ?? err) };
    }
  }

  async function byRange(active: ArchivePin): Promise<ContentFetchResult | 'unranged'> {
    const pass = () =>
      installByRange({
        url,
        pin: active,
        partial: contentPartialRoot(env),
        order: deps.priority?.() ?? [],
        fetchImpl: doFetch,
        signal: stop.signal,
        // Six at once, measured (pnpm cold-start --measure, 2026-09-27): on a
        // ~230 Mbps line to GitHub the whole Home set in 3.5-4.2 s against 4.5-4.7
        // at four and 2.9-3.9 at eight, the library in 6.8-7.4 s against 8.5-8.8
        // and 6.3-7.1; at 20 Mbps the line is the limit whatever the number, and
        // more at once only delays the first picture (2.4 s at four, 2.95 at
        // eight). SCENRI_CONTENT_CONCURRENCY is for that bench only.
        concurrency: deps.concurrency ?? benchNumber(env.SCENRI_CONTENT_CONCURRENCY, 1, 16) ?? 6,
        capBytes: deps.capBytes ?? 4 * 1024 * 1024,
        idleMs: deps.idleMs ?? 30_000,
        backoffMs: deps.backoffMs ?? [1000, 2000, 4000, 8000],
        onLanded: (f) => {
          if (landedNames.has(f[0])) return;
          landedNames.add(f[0]);
          landedBytes += f[2];
          if (isPicture(f)) landedPictures += 1;
        },
      });
    let result = await pass();
    if (result.kind === 'unranged') return 'unranged';
    if (result.kind === 'partial' && !stop.signal.aborted) {
      // One more pass a minute on, which rides out a dropped connection; what
      // still fails waits for the next start. Never a loop.
      await new Promise<void>((resolve) => {
        // SCENRI_CONTENT_RETRY_MS is for specs only (e2e/first-run-library.spec.ts)
        const t = setTimeout(
          resolve,
          deps.retryAfterMs ?? benchNumber(env.SCENRI_CONTENT_RETRY_MS, 0, 60_000) ?? 60_000,
        );
        t.unref?.();
        stop.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(t);
            resolve();
          },
          { once: true },
        );
      });
      if (!stop.signal.aborted) result = await pass();
    }
    if (result.kind === 'complete') return { ok: true, updated: true, error: null };
    if (result.kind === 'unranged') return 'unranged';
    failed = result.missing.filter(isPicture).length;
    return { ok: false, updated: false, error: `${result.missing.length} library files did not download` };
  }

  async function run(): Promise<ContentFetchResult> {
    disclose();
    startedAt ??= new Date().toISOString();
    const began = Date.now();
    // What an older build left half unpacked is never read again; this one keeps its work in content.partial.
    rmSync(`${contentCacheRoot(env)}.staging`, { recursive: true, force: true, maxRetries: 3 });
    let result: ContentFetchResult;
    try {
      const ranged = pin ? await byRange(pin) : 'unranged';
      result = ranged === 'unranged' ? await download() : ranged;
    } catch (err) {
      result = { ok: false, updated: false, error: String((err as Error)?.message ?? err) };
    }
    const seconds = ((Date.now() - began) / 1000).toFixed(1);
    if (result.ok) {
      const installed = installedContentRoot(env);
      try {
        const meta = JSON.parse(readFileSync(join(installed ?? '', 'meta.json'), 'utf8')) as {
          version?: number | string;
        };
        deps.store.setSetting('content.version', String(meta.version ?? ''));
      } catch {
        // versionless archives are legal; the marker file is what matters
      }
      outcome = 'complete';
      log(`  Scenri library ready (${seconds} s)`);
    } else if (!stop.signal.aborted) {
      outcome = 'partial';
      if (!failed && totals.total) failed = totals.total - landedPictures;
      log(`  Scenri library: ${result.error ?? 'did not download'} (${seconds} s); the next start tries again`);
    }
    return result;
  }

  async function ensure(): Promise<ContentFetchResult> {
    if (!enabled()) return { ok: false, updated: false, error: null };
    if (!contentCacheStale(env, custom)) return { ok: true, updated: false, error: null };
    inflight ??= run()
      .then((result) => {
        if (result.updated) installs += 1;
        else if (!result.ok) gaveUp = true;
        return result;
      })
      .finally(() => {
        inflight = null;
        stale = null;
      });
    return inflight;
  }

  function state(): ContentState {
    stale ??= contentCacheStale(env, custom);
    const on = enabled();
    return {
      arriving: on && !gaveUp && stale,
      installs,
      landed: landedPictures,
      bytes: landedBytes,
      failed,
      outcome,
      startedAt,
      ...totals,
    };
  }

  function schedule(): void {
    // Right after listen, never keeping the process alive. One run per start:
    // offline, the next start tries again.
    setTimeout(() => void ensure(), 0).unref();
  }

  async function settle(): Promise<void> {
    stop.abort();
    await inflight?.catch(() => {});
  }

  return { enabled, ensure, schedule, state, settle };
}
