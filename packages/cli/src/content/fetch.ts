import { mkdirSync, renameSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import JSZip from 'jszip';
import { contentCacheReady, contentCacheRoot } from './overlay.js';

/**
 * The library download: the npm package carries every catalog entry and its
 * thumbnail; the heavy imagery (reference galleries, showcase heroes, product
 * shots, presenter identity sets) arrives once from a versioned archive and
 * is cached under ~/.scenri/content. Same manners as the update check: said
 * once in the console, silent offline, opt-out-able (SCENRI_NO_CONTENT_FETCH=1
 * or the settings toggle), URL overridable for forks and airgaps
 * (SCENRI_CONTENT_URL).
 */

const DEFAULT_CONTENT_URL = 'https://github.com/tonygorb/scenri/releases/download/content-latest/scenri-content.zip';
const TIMEOUT_MS = 10 * 60 * 1000; // a ~95 MB archive on a slow line is fine; hung sockets are not

export function resolveContentUrl(env: Record<string, string | undefined> = process.env, override?: string): string {
  return override ?? env.SCENRI_CONTENT_URL ?? DEFAULT_CONTENT_URL;
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

export interface ContentFetcher {
  enabled(): boolean;
  ensure(): Promise<ContentFetchResult>;
  /** One attempt shortly after listen. Timer unref'd: never keeps the process alive. */
  schedule(): void;
}

export function createContentFetcher(deps: {
  store: SettingsLike;
  fetchImpl?: typeof fetch;
  url?: string;
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
}): ContentFetcher {
  const env = deps.env ?? process.env;
  const log = deps.log ?? console.log;
  const doFetch = deps.fetchImpl ?? fetch;
  const url = resolveContentUrl(env, deps.url);

  const enabled = () => env.SCENRI_NO_CONTENT_FETCH !== '1' && deps.store.getSetting('content.enabled') !== 'false';

  let inflight: Promise<ContentFetchResult> | null = null;

  async function download(): Promise<ContentFetchResult> {
    const root = contentCacheRoot(env);
    const staging = `${root}.staging`;
    if (!deps.store.getSetting('content.disclosed')) {
      // Same doctrine as the update check: the app's self-initiated requests
      // announce themselves once, with the off switch in the same breath.
      log('  fetching the Scenri library (~95 MB, once, cached; set SCENRI_NO_CONTENT_FETCH=1 to disable)');
      deps.store.setSetting('content.disclosed', '1');
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      if (typeof timer === 'object') timer.unref?.();
      let res: Response;
      try {
        res = await doFetch(url, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) return { ok: false, updated: false, error: `archive answered ${res.status}` };
      const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));

      rmSync(staging, { recursive: true, force: true });
      mkdirSync(staging, { recursive: true });
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
        return { ok: false, updated: false, error: 'archive carries no meta.json' };
      }
      rmSync(root, { recursive: true, force: true });
      renameSync(staging, root);
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
      // app, and the next launch simply tries again.
      rmSync(staging, { recursive: true, force: true });
      return { ok: false, updated: false, error: String((err as Error)?.message ?? err) };
    }
  }

  async function ensure(): Promise<ContentFetchResult> {
    if (!enabled()) return { ok: false, updated: false, error: null };
    if (contentCacheReady(env)) return { ok: true, updated: false, error: null };
    inflight ??= download().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  function schedule(): void {
    // Shortly after listen, never in the way of startup, never keeping the
    // process alive. One attempt per boot: offline retries on the next launch.
    setTimeout(() => void ensure(), 3000).unref();
  }

  return { enabled, ensure, schedule };
}
