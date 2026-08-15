/**
 * The one place that knows the on-disk shape of staged app versions:
 *
 *   $SCENRI_HOME/app/staging/<version>/           npm's workbench, disposable
 *   $SCENRI_HOME/app/versions/<version>/node_modules/<pkg>/
 *
 * A version dir counts only when its package.json agrees with its dirname and
 * the entry exists — existence-after-atomic-rename is the completion marker,
 * so there are no marker files to invent or forget. `rm -rf ~/.scenri/app` is
 * always safe: nothing in here is user data.
 *
 * The launcher imports this file, so it must stay on node builtins alone.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultHome(env: Record<string, string | undefined> = process.env): string {
  // duplicated from @scenri/core on purpose: importing core drags better-sqlite3
  // into the launcher, and a broken native module must never stop the launcher
  return env.SCENRI_HOME || join(homedir(), '.scenri');
}

export const appDir = (home: string): string => join(home, 'app');
export const stagingDir = (home: string): string => join(appDir(home), 'staging');
export const versionsDir = (home: string): string => join(appDir(home), 'versions');
export const pkgRoot = (home: string, pkg: string, version: string): string =>
  join(versionsDir(home), version, 'node_modules', pkg);
/** `node <entryOf(...)> serve` is the frozen launcher contract. */
export const entryOf = (home: string, pkg: string, version: string): string =>
  join(pkgRoot(home, pkg, version), 'dist', 'index.js');

/** Plain numeric triplets; anything else sorts below everything (no-alpha policy). */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string) => {
    const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

export function isValidVersionDir(home: string, pkg: string, version: string): boolean {
  try {
    const root = pkgRoot(home, pkg, version);
    if (!existsSync(join(root, 'dist', 'index.js'))) return false;
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return manifest.name === pkg && manifest.version === version;
  } catch {
    return false;
  }
}

/** Valid staged versions, ascending. */
export function listStaged(home: string, pkg: string): string[] {
  let names: string[];
  try {
    names = readdirSync(versionsDir(home));
  } catch {
    return [];
  }
  return names.filter((v) => isValidVersionDir(home, pkg, v)).sort(compareSemver);
}

export function newestStaged(home: string, pkg: string): string | null {
  const all = listStaged(home, pkg);
  return all[all.length - 1] ?? null;
}

/**
 * Keep the newest two valid versions plus everything in `keep` (the running
 * version, above all); delete the rest, invalid dirs included, and empty the
 * staging workbench of leftovers from interrupted installs.
 */
export function pruneStaged(home: string, pkg: string, keep: Set<string> = new Set()): void {
  const valid = listStaged(home, pkg);
  const survivors = new Set([...valid.slice(-2), ...keep]);
  let names: string[] = [];
  try {
    names = readdirSync(versionsDir(home));
  } catch {
    /* nothing staged, nothing to prune */
  }
  for (const v of names) {
    if (!survivors.has(v)) rmSync(join(versionsDir(home), v), { recursive: true, force: true });
  }
  rmSync(stagingDir(home), { recursive: true, force: true });
}
