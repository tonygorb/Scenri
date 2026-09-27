import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, existsSync, readFileSync, lstatSync, unlinkSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import JSZip from 'jszip';
import { contentCacheReady, contentCacheRoot, contentCacheVersion } from './overlay.js';

/**
 * The library download: the npm package carries every catalog entry and its
 * thumbnail; the heavy imagery (reference galleries, showcase heroes, product
 * shots, presenter identity sets) arrives once from a versioned archive and
 * is cached under ~/.scenri/content. Same manners as the update check: said
 * once in the console, silent offline, opt-out-able (SCENRI_NO_CONTENT_FETCH=1
 * or the settings toggle), URL overridable for forks and airgaps
 * (SCENRI_CONTENT_URL).
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
 * whether pictures are still on their way, and a count that moves when they
 * land. Never a percent: the archive is read in one piece, so there is no
 * honest one to give.
 */
export interface ContentState {
  /**
   * Library pictures are on their way: the download is on, the cache is not
   * the one this version wants, and this boot has not finished trying. True
   * from the first moment, before the attempt starts, so a studio that asks
   * early waits for it; false once an attempt fails, so nothing waits forever.
   */
  arriving: boolean;
  /** Installs this process has made. A change means the catalogs have pictures they lacked. */
  installs: number;
}

export interface ContentFetcher {
  enabled(): boolean;
  ensure(): Promise<ContentFetchResult>;
  /** One attempt shortly after listen. Timer unref'd: never keeps the process alive. */
  schedule(): void;
  state(): ContentState;
}

export function createContentFetcher(deps: {
  store: SettingsLike;
  fetchImpl?: typeof fetch;
  url?: string;
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
  /** The whole download's bound, headers through last byte; tests shorten it. */
  timeoutMs?: number;
  /** The archive's expected sha256; CONTENT_SHA256 unless the URL is custom. */
  sha256?: string | null;
}): ContentFetcher {
  const env = deps.env ?? process.env;
  const log = deps.log ?? console.log;
  const doFetch = deps.fetchImpl ?? fetch;
  const url = resolveContentUrl(env, deps.url);
  const custom = Boolean(deps.url ?? env.SCENRI_CONTENT_URL);
  const expected = deps.sha256 !== undefined ? deps.sha256 : custom ? null : CONTENT_SHA256;

  const enabled = () => env.SCENRI_NO_CONTENT_FETCH !== '1' && deps.store.getSetting('content.enabled') !== 'false';

  let inflight: Promise<ContentFetchResult> | null = null;
  // What the studio is told: whether this boot has tried and given up, and
  // how many installs it has made. Whether the cache is stale is read once
  // and again after each attempt, not on every poll.
  let gaveUp = false;
  let installs = 0;
  let stale: boolean | null = null;

  async function download(): Promise<ContentFetchResult> {
    const root = contentCacheRoot(env);
    if (!deps.store.getSetting('content.disclosed')) {
      // Same doctrine as the update check: the app's self-initiated requests
      // announce themselves once, with the off switch in the same breath.
      log('  fetching the Scenri library (~155 MB, once, cached; set SCENRI_NO_CONTENT_FETCH=1 to disable)');
      deps.store.setSetting('content.disclosed', '1');
    }
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
      try {
        const meta = JSON.parse(readFileSync(join(root, 'meta.json'), 'utf8')) as { version?: number | string };
        deps.store.setSetting('content.version', String(meta.version ?? ''));
      } catch {
        // versionless archives are legal; the marker file is what matters
      }
      log('  Scenri library ready');
      return { ok: true, updated: true, error: null };
    } catch (err) {
      // Offline is a non-event: the bundled catalog and thumbnails carry the
      // app (or the older cache does), and the next launch simply tries again.
      return { ok: false, updated: false, error: String((err as Error)?.message ?? err) };
    }
  }

  async function ensure(): Promise<ContentFetchResult> {
    if (!enabled()) return { ok: false, updated: false, error: null };
    if (!contentCacheStale(env, custom)) return { ok: true, updated: false, error: null };
    inflight ??= download()
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
    if (!enabled() || gaveUp) return { arriving: false, installs };
    stale ??= contentCacheStale(env, custom);
    return { arriving: stale, installs };
  }

  function schedule(): void {
    // Shortly after listen, never in the way of startup, never keeping the
    // process alive. One attempt per boot: offline retries on the next launch.
    setTimeout(() => void ensure(), 3000).unref();
  }

  return { enabled, ensure, schedule, state };
}
