import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The downloaded library cache: `~/.scenri/content` mirrors the templates/
 * tree. A repo or bundled file always wins; the cache only fills what the
 * install did not carry (reference galleries, showcase heroes, product shots,
 * presenter identity sets).
 *
 * A download in progress puts each file, once its own hash is checked, in
 * `content.partial` beside the cache, and writes the archive's meta.json
 * there last. So meta.json is the completeness marker in both places: a
 * complete partial is the installed library until the next start moves it
 * into place (fetch.ts finishContentInstall), and an incomplete one is read
 * only to show a picture that has already arrived (shownFile), never by
 * generation (contentFile), which uses a library only once it is whole.
 */

export function contentCacheRoot(env: Record<string, string | undefined> = process.env): string {
  // Deliberately mirrors defaultHome() in @scenri/core and versionsDir.ts: a
  // sibling of images/ and app/, never inside app/ — `rm -rf ~/.scenri/app`
  // must stay safe, and the wipe route's user-data list must not cover this.
  return join(env.SCENRI_HOME || join(homedir(), '.scenri'), 'content');
}

/** Where a download in progress puts each verified file (fetch.ts). */
export function contentPartialRoot(env: Record<string, string | undefined> = process.env): string {
  return `${contentCacheRoot(env)}.partial`;
}

/** The whole library as it stands: a complete download not yet moved into place, else the cache; null when neither. */
export function installedContentRoot(env: Record<string, string | undefined> = process.env): string | null {
  const partial = contentPartialRoot(env);
  if (existsSync(join(partial, 'meta.json'))) return partial;
  const root = contentCacheRoot(env);
  return existsSync(join(root, 'meta.json')) ? root : null;
}

export function contentCacheReady(env?: Record<string, string | undefined>): boolean {
  return installedContentRoot(env) !== null;
}

/** The installed archive's version; 0 when there is none, or it is versionless or unreadable. */
export function contentCacheVersion(env?: Record<string, string | undefined>): number {
  const root = installedContentRoot(env);
  if (!root) return 0;
  try {
    const meta = JSON.parse(readFileSync(join(root, 'meta.json'), 'utf8')) as { version?: unknown };
    const version = Number(meta.version);
    return Number.isFinite(version) ? version : 0;
  } catch {
    return 0;
  }
}

/** A path helper's choice of where to look: contentFile for what a shot is made from, shownFile for a picture on screen. */
export type ContentLookup = (templatesRoot: string, ...segments: string[]) => string;

/** First existing of the bundled file then the installed library's; the bundled path when neither exists (canonical 404 target). */
export function contentFile(templatesRoot: string, ...segments: string[]): string {
  const primary = join(templatesRoot, ...segments);
  if (existsSync(primary)) return primary;
  const installed = installedContentRoot();
  if (installed) {
    const cached = join(installed, ...segments);
    if (existsSync(cached)) return cached;
  }
  return primary;
}

/**
 * For showing a picture only: contentFile, plus a file a download in
 * progress has already checked. Never for what a shot is made from: a
 * presenter half arrived is not a presenter to draw from.
 */
export function shownFile(templatesRoot: string, ...segments: string[]): string {
  const primary = join(templatesRoot, ...segments);
  if (existsSync(primary)) return primary;
  const arrived = join(contentPartialRoot(), ...segments);
  if (existsSync(arrived)) return arrived;
  return contentFile(templatesRoot, ...segments);
}

/** Union listing of a directory that may exist in either tree; [] when in neither. */
export function contentDirList(templatesRoot: string, ...segments: string[]): string[] {
  const names = new Set<string>();
  const primary = join(templatesRoot, ...segments);
  if (existsSync(primary)) for (const n of readdirSync(primary)) names.add(n);
  const installed = installedContentRoot();
  if (installed) {
    const cached = join(installed, ...segments);
    if (existsSync(cached)) for (const n of readdirSync(cached)) names.add(n);
  }
  return [...names].sort();
}

/** contentDirList plus what a download in progress has already checked, for showing only (see shownFile). */
export function shownDirList(templatesRoot: string, ...segments: string[]): string[] {
  const names = new Set(contentDirList(templatesRoot, ...segments));
  const arrived = join(contentPartialRoot(), ...segments);
  if (existsSync(arrived)) for (const n of readdirSync(arrived)) if (!n.endsWith('.part')) names.add(n);
  return [...names].sort();
}
