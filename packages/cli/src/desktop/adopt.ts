/**
 * A fresh `npx scenri` runs out of npm's cache and ~/.scenri/app/versions is
 * empty, while the desktop icon boots only from versions/. Adopting copies the
 * running build there once, shaped exactly like a staged update (the same
 * validity rules, the same atomic rename, the same pruning), so the icon works
 * offline, after `npm cache clean`, and keeps working when the in-app updater
 * stages something newer. Node builtins only.
 */
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isValidVersionDir, pruneStaged, stagingDir, versionsDir } from '../update/versionsDir.js';

export type AdoptResult = { adopted: true } | { adopted: false; reason: 'dev' | 'managed' | 'present' | 'no-source' };

export type VerifyImpl = (entry: string) => Promise<boolean>;

export async function adoptRunningInstall(deps: {
  home: string;
  pkg: string;
  version: string;
  /** The running dist/index.js, realpathed (fileURLToPath(import.meta.url)). */
  ownEntry: string;
  installKind: 'dev' | 'managed' | 'npx' | 'global' | 'unknown';
  /** Proves the copy loads under this node; the updater's own hop by default. */
  verifyImpl?: VerifyImpl;
}): Promise<AdoptResult> {
  if (deps.installKind === 'dev') return { adopted: false, reason: 'dev' };
  if (deps.installKind === 'managed') return { adopted: false, reason: 'managed' };
  if (isValidVersionDir(deps.home, deps.pkg, deps.version)) return { adopted: false, reason: 'present' };

  const pkgRoot = dirname(dirname(deps.ownEntry));
  if (!existsSync(deps.ownEntry) || manifestVersion(pkgRoot) !== deps.version) {
    return { adopted: false, reason: 'no-source' };
  }
  // npm hoists a package's dependencies beside it in the npx cache and nests
  // them inside it for a global install; fastify is the one dependency every
  // build has, so its whereabouts say which shape this is.
  const nested = existsSync(join(pkgRoot, 'node_modules', 'fastify'));
  const source = nested ? pkgRoot : dirname(pkgRoot);

  const work = join(stagingDir(deps.home), `adopt-${deps.version}`);
  rmSync(work, { recursive: true, force: true });
  const dest = nested ? join(work, 'node_modules', deps.pkg) : join(work, 'node_modules');
  mkdirSync(dirname(dest), { recursive: true });
  try {
    cpSync(source, dest, { recursive: true, verbatimSymlinks: true });
    // A tree can look complete and still not load: a checkout's dist copied
    // out from under its pnpm symlinks, a native module built for another
    // node. The same probe the updater runs on a staged install decides.
    const copied = join(work, 'node_modules', deps.pkg, 'dist', 'index.js');
    if (!(await (deps.verifyImpl ?? verifyEntry)(copied))) return { adopted: false, reason: 'no-source' };
    const target = join(versionsDir(deps.home), deps.version);
    mkdirSync(dirname(target), { recursive: true });
    rmSync(target, { recursive: true, force: true });
    renameSync(work, target);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  pruneStaged(deps.home, deps.pkg, new Set([deps.version]));
  return { adopted: true };
}

/** `node <entry> verify` answers a JSON line; ok means every native module loaded. */
export function verifyEntry(entry: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [entry, 'verify'],
      { encoding: 'utf8', timeout: 120_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(false);
        const line = String(stdout)
          .trim()
          .split('\n')
          .reverse()
          .find((l) => l.startsWith('{'));
        try {
          resolve(Boolean(line && (JSON.parse(line) as { ok?: boolean }).ok === true));
        } catch {
          resolve(false);
        }
      },
    );
  });
}

function manifestVersion(pkgRoot: string): string | null {
  try {
    return (JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}
