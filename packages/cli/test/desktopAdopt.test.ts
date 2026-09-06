import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adoptRunningInstall } from '../src/desktop/adopt.js';
import { entryOf, stagingDir, versionsDir } from '../src/update/versionsDir.js';

/**
 * A fresh `npx scenri` runs out of npm's cache, and ~/.scenri/app/versions is
 * empty. The desktop icon boots from versions/, so installing it copies the
 * running build there once: offline, and shaped exactly like a staged update.
 */

let root: string;
let home: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sc-adopt-'));
  home = join(root, 'home');
  mkdirSync(home, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const PKG = 'scenri';
const yes = async () => true;

/** An npx cache: the package and its dependencies hoisted side by side. */
function plantNpx(version: string, opts: { entry?: boolean } = {}) {
  const nm = join(root, '_npx', 'abc123', 'node_modules');
  mkdirSync(join(nm, PKG, 'dist'), { recursive: true });
  mkdirSync(join(nm, 'fastify'), { recursive: true });
  mkdirSync(join(nm, '.bin'), { recursive: true });
  writeFileSync(join(nm, PKG, 'package.json'), JSON.stringify({ name: PKG, version }));
  if (opts.entry !== false) writeFileSync(join(nm, PKG, 'dist', 'index.js'), '// entry');
  writeFileSync(join(nm, 'fastify', 'package.json'), JSON.stringify({ name: 'fastify', version: '5.0.0' }));
  return join(nm, PKG, 'dist', 'index.js');
}

/** A global install: dependencies nested inside the package. */
function plantGlobal(version: string) {
  const pkgRoot = join(root, 'lib', 'node_modules', PKG);
  mkdirSync(join(pkgRoot, 'dist'), { recursive: true });
  mkdirSync(join(pkgRoot, 'node_modules', 'fastify'), { recursive: true });
  writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({ name: PKG, version }));
  writeFileSync(join(pkgRoot, 'dist', 'index.js'), '// entry');
  writeFileSync(join(pkgRoot, 'node_modules', 'fastify', 'package.json'), JSON.stringify({ name: 'fastify' }));
  return join(pkgRoot, 'dist', 'index.js');
}

describe('adoptRunningInstall', () => {
  it('copies an npx install, dependencies included, into app/versions/<v>', async () => {
    const ownEntry = plantNpx('0.8.4');
    const res = await adoptRunningInstall({
      home,
      pkg: PKG,
      version: '0.8.4',
      ownEntry,
      installKind: 'npx',
      verifyImpl: yes,
    });
    expect(res).toEqual({ adopted: true });
    expect(existsSync(entryOf(home, PKG, '0.8.4'))).toBe(true);
    expect(existsSync(join(versionsDir(home), '0.8.4', 'node_modules', 'fastify', 'package.json'))).toBe(true);
    // the workbench is gone once the rename lands
    expect(existsSync(stagingDir(home))).toBe(false);
  });

  it('copies a global install with its nested dependencies', async () => {
    const ownEntry = plantGlobal('0.8.4');
    expect(
      await adoptRunningInstall({ home, pkg: PKG, version: '0.8.4', ownEntry, installKind: 'global', verifyImpl: yes }),
    ).toEqual({
      adopted: true,
    });
    expect(existsSync(entryOf(home, PKG, '0.8.4'))).toBe(true);
    const pkgDir = join(versionsDir(home), '0.8.4', 'node_modules', PKG);
    expect(existsSync(join(pkgDir, 'node_modules', 'fastify', 'package.json'))).toBe(true);
    expect(existsSync(join(versionsDir(home), '0.8.4', 'node_modules', 'fastify'))).toBe(false);
  });

  it('is a no-op when that version is already staged', async () => {
    const ownEntry = plantNpx('0.8.4');
    await adoptRunningInstall({ home, pkg: PKG, version: '0.8.4', ownEntry, installKind: 'npx', verifyImpl: yes });
    expect(
      await adoptRunningInstall({ home, pkg: PKG, version: '0.8.4', ownEntry, installKind: 'npx', verifyImpl: yes }),
    ).toEqual({
      adopted: false,
      reason: 'present',
    });
  });

  it('never adopts a source checkout or a build that already runs from versions/', async () => {
    const ownEntry = plantNpx('0.8.4');
    expect(
      await adoptRunningInstall({ home, pkg: PKG, version: '0.8.4', ownEntry, installKind: 'dev', verifyImpl: yes }),
    ).toEqual({
      adopted: false,
      reason: 'dev',
    });
    expect(
      await adoptRunningInstall({
        home,
        pkg: PKG,
        version: '0.8.4',
        ownEntry,
        installKind: 'managed',
        verifyImpl: yes,
      }),
    ).toEqual({
      adopted: false,
      reason: 'managed',
    });
    expect(existsSync(versionsDir(home))).toBe(false);
  });

  it('discards a copy that does not verify under this node, like a staged update would', async () => {
    // A checkout's dist copied out from under its pnpm symlinks looks valid
    // and cannot load: only running `verify` on the copy knows.
    const ownEntry = plantNpx('0.8.4');
    const verified: string[] = [];
    const res = await adoptRunningInstall({
      home,
      pkg: PKG,
      version: '0.8.4',
      ownEntry,
      installKind: 'npx',
      verifyImpl: async (entry) => {
        verified.push(entry);
        return false;
      },
    });
    expect(res).toEqual({ adopted: false, reason: 'no-source' });
    expect(verified).toHaveLength(1);
    expect(verified[0]).toContain(join('app', 'staging', 'adopt-0.8.4'));
    expect(existsSync(join(versionsDir(home), '0.8.4'))).toBe(false);
    expect(existsSync(stagingDir(home)) ? readdirSync(stagingDir(home)) : []).toEqual([]);
  });

  it('leaves nothing behind when the running tree is not a valid package', async () => {
    const ownEntry = plantNpx('0.8.4', { entry: false });
    expect(
      await adoptRunningInstall({ home, pkg: PKG, version: '0.8.4', ownEntry, installKind: 'npx', verifyImpl: yes }),
    ).toEqual({
      adopted: false,
      reason: 'no-source',
    });
    expect(existsSync(join(versionsDir(home), '0.8.4'))).toBe(false);
    expect(existsSync(stagingDir(home)) ? readdirSync(stagingDir(home)) : []).toEqual([]);
  });
});
