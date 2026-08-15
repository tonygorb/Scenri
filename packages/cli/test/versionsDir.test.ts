import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compareSemver,
  entryOf,
  isValidVersionDir,
  listStaged,
  newestStaged,
  pruneStaged,
  stagingDir,
  versionsDir,
} from '../src/update/versionsDir.js';

let home: string;
const PKG = 'scenri';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-vdir-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** Lay down a staged version dir; broken=true skips the package.json. */
function plant(version: string, opts: { broken?: boolean; wrongVersion?: string } = {}) {
  const root = join(versionsDir(home), version, 'node_modules', PKG);
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'dist', 'index.js'), '// entry');
  if (!opts.broken) {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: PKG, version: opts.wrongVersion ?? version }));
  }
}

describe('semver compare', () => {
  it.each([
    ['0.1.0', '0.2.0', -1],
    ['0.2.0', '0.1.0', 1],
    ['1.0.0', '1.0.0', 0],
    ['0.10.0', '0.9.9', 1],
    ['not-a-version', '0.0.1', -1],
  ])('%s vs %s → %i', (a, b, want) => {
    expect(compareSemver(a, b)).toBe(want);
  });
});

describe('staged version dirs', () => {
  it('a dir is valid only when its package.json version matches its name and the entry exists', () => {
    plant('0.2.0');
    plant('0.3.0', { broken: true });
    plant('0.4.0', { wrongVersion: '0.9.9' });
    expect(isValidVersionDir(home, PKG, '0.2.0')).toBe(true);
    expect(isValidVersionDir(home, PKG, '0.3.0')).toBe(false);
    expect(isValidVersionDir(home, PKG, '0.4.0')).toBe(false);
    expect(isValidVersionDir(home, PKG, '9.9.9')).toBe(false);
  });

  it('lists valid versions ascending and picks the newest', () => {
    plant('0.10.0');
    plant('0.2.0');
    plant('0.9.0', { broken: true });
    expect(listStaged(home, PKG)).toEqual(['0.2.0', '0.10.0']);
    expect(newestStaged(home, PKG)).toBe('0.10.0');
  });

  it('is empty when nothing was ever staged', () => {
    expect(listStaged(home, PKG)).toEqual([]);
    expect(newestStaged(home, PKG)).toBeNull();
  });

  it('entryOf points into the staged package dist', () => {
    expect(entryOf(home, PKG, '0.2.0')).toBe(join(versionsDir(home), '0.2.0', 'node_modules', PKG, 'dist', 'index.js'));
  });

  it('prunes to the newest two plus whatever must be kept, and clears staging leftovers', () => {
    for (const v of ['0.1.0', '0.2.0', '0.3.0', '0.4.0']) plant(v);
    mkdirSync(join(stagingDir(home), '0.5.0'), { recursive: true });

    pruneStaged(home, PKG, new Set(['0.1.0']));

    expect(listStaged(home, PKG)).toEqual(['0.1.0', '0.3.0', '0.4.0']);
    expect(existsSync(join(stagingDir(home), '0.5.0'))).toBe(false);
  });
});
