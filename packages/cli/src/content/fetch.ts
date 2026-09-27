import { existsSync, lstatSync, readFileSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import pinJson from './pin.json' with { type: 'json' };
import {
  contentCacheReady,
  contentCacheRoot,
  contentCacheVersion,
  contentPartialRoot,
  installedContentRoot,
} from './overlay.js';
import { type ArchivePin, archiveFetch, installByRange, type PinnedFile, type RangedResult } from './ranged.js';

/**
 * The library download: the npm package carries every catalog entry, the
 * scene and presenter cards and the starter wall; the heavy imagery
 * (reference galleries, the rest of the showcase heroes, product shots,
 * presenter identity sets) arrives once from a versioned archive and is
 * cached under ~/.scenri/content. Same manners as the update check: said once
 * in the console, silent offline, opt-out-able (SCENRI_NO_CONTENT_FETCH=1),
 * URL overridable for mirrors, forks and airgaps (SCENRI_CONTENT_URL, with
 * SCENRI_CONTENT_PIN for an archive of their own).
 *
 * One install, file by file (ranged.ts): the pinned archive is read by byte
 * range, Home's pictures first, and each file is kept only once its own hash
 * matches the pin. A host that does not answer ranges is read whole and
 * installed from memory the same way.
 */

/**
 * The archive this build expects, file by file. The pin is the one place its
 * version, tag and sha256 live: scripts/pin-content.mts writes it from the
 * published zip, so a content release is that one command (and the tag in the
 * workflows, which contentVersion.test.ts holds in step). A cache older than
 * CONTENT_VERSION is replaced on the next launch, so a catalog that now names
 * new pictures never runs against the pictures of an older library. A release
 * asset can be replaced on GitHub; a build installs only the bytes it was
 * released against.
 */
export const CONTENT_PIN = pinJson as ArchivePin;
export const CONTENT_VERSION = CONTENT_PIN.version;
export const CONTENT_TAG = `content-v${CONTENT_VERSION}`;
export const CONTENT_SHA256 = CONTENT_PIN.sha256;

const DEFAULT_CONTENT_URL = `https://github.com/tonygorb/scenri/releases/download/${CONTENT_TAG}/scenri-content.zip`;
// A host taken whole, headers through last byte: ~155 MB inside it needs about 0.7 Mbps, and a
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
 * At start, before anything is served: a download that finished last time in
 * content.partial is moved into place. Never while the server runs, where a
 * picture being read or a derivative being cut could lose its file mid-way.
 * If the move fails (a Windows lock), the complete partial keeps serving as
 * the installed library and the next start tries again. A lane's linked cache
 * is unlinked, never emptied.
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

/**
 * An archive already in hand (pull-content's file, CI's download) installed
 * the way the app installs a download: file by file against the pin, into
 * content.partial, then moved into place. Returns why it refused, or null
 * once the library is in place; a refused archive leaves the old one serving.
 */
export async function installArchive(
  bytes: Buffer,
  env: Record<string, string | undefined> = process.env,
  pin: ArchivePin = CONTENT_PIN,
): Promise<string | null> {
  if (!pin.files.some((f) => f[0] === 'meta.json')) return 'archive carries no meta.json';
  if (bytes.length !== pin.size) return `the archive is ${bytes.length} bytes, not the ${pin.size} its pin says`;
  const result = await installByRange({
    url: 'archive:',
    pin,
    partial: contentPartialRoot(env),
    order: [],
    fetchImpl: archiveFetch(bytes),
    signal: new AbortController().signal,
    concurrency: 4,
    capBytes: 16 * 1024 * 1024,
    idleMs: 30_000,
    backoffMs: [],
    onLanded: () => {},
  });
  if (result.kind === 'partial') return `${result.missing.length} files in the archive do not match its pin`;
  if (result.kind !== 'complete') return 'the archive could not be read';
  return finishContentInstall(env) === 'kept' ? 'the library could not be moved into place' : null;
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
  /** A host taken whole: the bound, headers through last byte; tests shorten it. */
  timeoutMs?: number;
  /** The file-by-file pin: the built-in one for the release and its mirrors, SCENRI_CONTENT_PIN for an archive of one's own. */
  pin?: ArchivePin | null;
  /** Library files to fetch first, most wanted first (priority.ts); the rest follow in archive order. */
  priority?: () => readonly string[];
  /** The package's own copy of the library files it carries (templates/): the identical ones are copied, not fetched. */
  seed?: string;
  concurrency?: number;
  capBytes?: number;
  idleMs?: number;
  backoffMs?: readonly number[];
  /** After a run that ended partial, when to ask whether the host answers again before the one more pass. */
  retryWaitsMs?: readonly number[];
}): ContentFetcher {
  const env = deps.env ?? process.env;
  const log = deps.log ?? console.log;
  const doFetch = deps.fetchImpl ?? fetch;
  const url = resolveContentUrl(env, deps.url);
  const custom = Boolean(deps.url ?? env.SCENRI_CONTENT_URL);
  const pin = (() => {
    if (deps.pin !== undefined) return deps.pin;
    if (custom && env.SCENRI_CONTENT_PIN) {
      try {
        return JSON.parse(readFileSync(env.SCENRI_CONTENT_PIN, 'utf8')) as ArchivePin;
      } catch {
        return null;
      }
    }
    // The release, or a mirror of it: an archive of another size is refused before anything is fetched.
    return CONTENT_PIN;
  })();
  // SCENRI_CONTENT_RETRY_MS is for specs only (e2e/first-run-library.spec.ts)
  const specRetry = benchNumber(env.SCENRI_CONTENT_RETRY_MS, 0, 60_000);
  const retryWaits = deps.retryWaitsMs ?? (specRetry !== undefined ? [specRetry] : [5_000, 10_000, 15_000, 30_000]);

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

  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      if (stop.signal.aborted) return resolve();
      const t = setTimeout(resolve, ms);
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

  /** One pass of the file-by-file install, over the network, or from an archive in memory (no retries: its bytes never change). */
  const pass = (active: ArchivePin, via: typeof fetch, inMemory = false) =>
    installByRange({
      url,
      pin: active,
      partial: contentPartialRoot(env),
      order: deps.priority?.() ?? [],
      seed: deps.seed,
      fetchImpl: via,
      signal: stop.signal,
      // Eight at once, measured (pnpm cold-start --measure, 2026-09-27, each
      // file landing as its bytes arrive): on a ~230 Mbps line to GitHub the
      // Home set in 2.95-3.59 s against 3.48-4.90 at six, the library in
      // 6.2-7.0 s against 6.9-8.2; at 20 Mbps the line is the limit whatever the
      // number (60.2 s where the line needs 59.4), and eight costs the first
      // picture 0.3 s there. Reads merge up to 4 MiB: 16 bought nothing and
      // held more memory. SCENRI_CONTENT_CONCURRENCY and SCENRI_CONTENT_CAP_MB
      // are for that bench only.
      concurrency: deps.concurrency ?? benchNumber(env.SCENRI_CONTENT_CONCURRENCY, 1, 16) ?? 8,
      capBytes: deps.capBytes ?? (benchNumber(env.SCENRI_CONTENT_CAP_MB, 1, 64) ?? 4) * 1024 * 1024,
      idleMs: deps.idleMs ?? 30_000,
      backoffMs: inMemory ? [] : (deps.backoffMs ?? [1000, 2000, 4000, 8000]),
      onLanded: (f) => {
        if (landedNames.has(f[0])) return;
        landedNames.add(f[0]);
        landedBytes += f[2];
        if (isPicture(f)) landedPictures += 1;
      },
    });

  /** A host that ignores ranges (a proxy, a plain file server): the archive read whole, within the bound. */
  async function whole(): Promise<Buffer> {
    const ctrl = new AbortController();
    const onStop = () => ctrl.abort();
    stop.signal.addEventListener('abort', onStop, { once: true });
    const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? TIMEOUT_MS);
    timer.unref?.();
    try {
      // The bytes are read inside the timer, and the signal aborts the body as
      // well as the request: a server that sends headers and then goes quiet
      // would otherwise hold this download, and every ensure() waiting on it,
      // for as long as the process lives.
      const res = await doFetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`archive answered ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
      stop.signal.removeEventListener('abort', onStop);
    }
  }

  /** Whether the host answers a range again, so the one more pass has something to talk to. */
  async function hostAnswers(): Promise<boolean> {
    try {
      const res = await doFetch(url, {
        headers: { range: 'bytes=0-0' },
        signal: AbortSignal.any([stop.signal, AbortSignal.timeout(10_000)]),
      });
      await res.body?.cancel().catch(() => {});
      return res.status === 206;
    } catch {
      return false;
    }
  }

  async function install(active: ArchivePin): Promise<ContentFetchResult> {
    let result: RangedResult = await pass(active, doFetch);
    if (result.kind === 'unranged') {
      const bytes = await whole();
      result =
        bytes.length === active.size
          ? await pass(active, archiveFetch(bytes), true)
          : { kind: 'mismatch', size: bytes.length };
    } else if (result.kind === 'partial' && !stop.signal.aborted) {
      // One more pass as soon as the host answers again (asked at 5, 15, 30
      // and 60 s): a dropped connection costs seconds rather than a fixed
      // minute, and what still fails waits for the next start. Never a loop.
      for (const ms of retryWaits) {
        await pause(ms);
        if (stop.signal.aborted || (await hostAnswers())) break;
      }
      if (!stop.signal.aborted) result = await pass(active, doFetch);
    }
    if (result.kind === 'complete') return { ok: true, updated: true, error: null };
    if (result.kind === 'mismatch') {
      return {
        ok: false,
        updated: false,
        error: `the archive there is ${result.size} bytes, not the ${active.size} this version pins (an archive of one's own needs SCENRI_CONTENT_PIN)`,
      };
    }
    if (result.kind === 'unranged')
      return { ok: false, updated: false, error: 'the library host stopped answering byte ranges' };
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
      result = pin ? await install(pin) : { ok: false, updated: false, error: 'SCENRI_CONTENT_PIN could not be read' };
    } catch (err) {
      // Offline is a non-event: the bundled catalog and thumbnails carry the
      // app (or the older cache does), and the next launch simply tries again.
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
