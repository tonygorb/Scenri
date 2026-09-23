import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The downloaded library cache: `~/.scenri/content` mirrors the templates/
 * tree. A repo or bundled file always wins; the cache only fills what the
 * install did not carry (reference galleries, showcase heroes, product shots,
 * presenter identity sets). The cache is consulted only once a completed
 * download exists — meta.json is written by the atomic swap in fetch.ts, so
 * its presence is the completeness marker.
 */

export function contentCacheRoot(env: Record<string, string | undefined> = process.env): string {
  // Deliberately mirrors defaultHome() in @scenri/core and versionsDir.ts: a
  // sibling of images/ and app/, never inside app/ — `rm -rf ~/.scenri/app`
  // must stay safe, and the wipe route's user-data list must not cover this.
  return join(env.SCENRI_HOME || join(homedir(), '.scenri'), 'content');
}

export function contentCacheReady(env?: Record<string, string | undefined>): boolean {
  return existsSync(join(contentCacheRoot(env), 'meta.json'));
}

/** The cached archive's version; 0 when there is no cache, or it is versionless or unreadable. */
export function contentCacheVersion(env?: Record<string, string | undefined>): number {
  try {
    const meta = JSON.parse(readFileSync(join(contentCacheRoot(env), 'meta.json'), 'utf8')) as { version?: unknown };
    const version = Number(meta.version);
    return Number.isFinite(version) ? version : 0;
  } catch {
    return 0;
  }
}

/** First existing of the bundled file then the cached file; the bundled path when neither exists (canonical 404 target). */
export function contentFile(templatesRoot: string, ...segments: string[]): string {
  const primary = join(templatesRoot, ...segments);
  if (existsSync(primary)) return primary;
  if (contentCacheReady()) {
    const cached = join(contentCacheRoot(), ...segments);
    if (existsSync(cached)) return cached;
  }
  return primary;
}

/** Union listing of a directory that may exist in either tree; [] when in neither. */
export function contentDirList(templatesRoot: string, ...segments: string[]): string[] {
  const names = new Set<string>();
  const primary = join(templatesRoot, ...segments);
  if (existsSync(primary)) for (const n of readdirSync(primary)) names.add(n);
  if (contentCacheReady()) {
    const cached = join(contentCacheRoot(), ...segments);
    if (existsSync(cached)) for (const n of readdirSync(cached)) names.add(n);
  }
  return [...names].sort();
}
