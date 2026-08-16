import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findNpm, stageVersion } from '../src/update/stage.js';
import { entryOf, listStaged, stagingDir } from '../src/update/versionsDir.js';

const PKG = 'scenri';
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-stage-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** A runNpm that "installs" by planting the package tree into the prefix. */
function plantingNpm(version: string, opts: { name?: string; code?: number } = {}) {
  const argvSeen: string[][] = [];
  const run = async (argv: string[]) => {
    argvSeen.push(argv);
    if (opts.code) return { code: opts.code, output: 'npm ERR! boom' };
    const prefixFlag = argv.indexOf('--prefix');
    const prefix = argv[prefixFlag + 1];
    const root = join(prefix, 'node_modules', PKG);
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: opts.name ?? PKG, version }));
    writeFileSync(join(root, 'dist', 'index.js'), '// staged entry');
    return { code: 0, output: '' };
  };
  return { run, argvSeen };
}

const okVerify = (version: string) => async () => ({ ok: true as const, version });

describe('findNpm', () => {
  it('prefers npm on PATH', () => {
    expect(findNpm({ canRun: (argv) => argv[0] === 'npm' })).toEqual(['npm']);
  });
  it('falls back to npm_execpath when it is npm', () => {
    const found = findNpm({
      canRun: (argv) => argv[0] !== 'npm',
      env: { npm_execpath: '/x/npm-cli.js' },
    });
    expect(found).toEqual([process.execPath, '/x/npm-cli.js']);
  });
  it('yields null when neither answers (pnpm-run shells included)', () => {
    expect(findNpm({ canRun: () => false, env: { npm_execpath: '/x/pnpm.cjs' } })).toBeNull();
  });
});

describe('stageVersion', () => {
  it('installs into staging, verifies, promotes atomically, and prunes', async () => {
    const npm = plantingNpm('0.9.4');
    const res = await stageVersion({
      home,
      pkg: PKG,
      source: { version: '0.9.4' },
      npmArgv: ['npm'],
      runImpl: npm.run,
      verifyImpl: okVerify('0.9.4'),
    });
    expect(res).toEqual({ ok: true, version: '0.9.4', entry: entryOf(home, PKG, '0.9.4') });
    expect(listStaged(home, PKG)).toEqual(['0.9.4']);
    expect(existsSync(stagingDir(home))).toBe(false);
    const install = npm.argvSeen[0].join(' ');
    expect(install).toContain('install scenri@0.9.4');
    expect(install).toContain('--omit=dev');
  });

  it('passes the fork/mirror registry through', async () => {
    const npm = plantingNpm('0.9.4');
    await stageVersion({
      home,
      pkg: PKG,
      source: { version: '0.9.4' },
      registry: 'http://127.0.0.1:9999',
      npmArgv: ['npm'],
      runImpl: npm.run,
      verifyImpl: okVerify('0.9.4'),
    });
    expect(npm.argvSeen[0].join(' ')).toContain('--registry http://127.0.0.1:9999');
  });

  it('refuses a package that is not what it claims', async () => {
    const npm = plantingNpm('0.9.4', { name: 'not-scenri' });
    const res = await stageVersion({
      home,
      pkg: PKG,
      source: { version: '0.9.4' },
      npmArgv: ['npm'],
      runImpl: npm.run,
      verifyImpl: okVerify('0.9.4'),
    });
    expect(res).toMatchObject({ ok: false, reason: 'invalid-package' });
    expect(listStaged(home, PKG)).toEqual([]);
  });

  it('does not promote a version that fails its own verify', async () => {
    const npm = plantingNpm('0.9.4');
    const res = await stageVersion({
      home,
      pkg: PKG,
      source: { version: '0.9.4' },
      npmArgv: ['npm'],
      runImpl: npm.run,
      verifyImpl: async () => ({ ok: false, error: 'sharp failed to load' }),
    });
    expect(res).toMatchObject({ ok: false, reason: 'verify-failed', detail: expect.stringContaining('sharp') });
    expect(listStaged(home, PKG)).toEqual([]);
    expect(existsSync(stagingDir(home))).toBe(false);
  });

  it('surfaces a failed install without leaving debris', async () => {
    const npm = plantingNpm('0.9.4', { code: 1 });
    const res = await stageVersion({
      home,
      pkg: PKG,
      source: { version: '0.9.4' },
      npmArgv: ['npm'],
      runImpl: npm.run,
      verifyImpl: okVerify('0.9.4'),
    });
    expect(res).toMatchObject({ ok: false, reason: 'install-failed' });
    expect(existsSync(stagingDir(home))).toBe(false);
  });

  it('degrades cleanly when npm cannot be found', async () => {
    const res = await stageVersion({ home, pkg: PKG, source: { version: '0.9.4' }, npmArgv: null });
    expect(res).toMatchObject({ ok: false, reason: 'no-npm' });
  });

  // Integration, so it needs a working npm on the machine — CI always has one.
  const npmWorks = (() => {
    try {
      return spawnSync('npm', ['--version'], { stdio: 'ignore', timeout: 10_000 }).status === 0;
    } catch {
      return false;
    }
  })();

  it.skipIf(!npmWorks)(
    'stages a real tarball with the real npm and the real verify hop',
    async () => {
      // a fake scenri whose entry actually answers `verify`
      const src = mkdtempSync(join(tmpdir(), 'sc-fakepkg-'));
      // npm's default cache may not be writable in a sandboxed test run
      const prevCache = process.env.npm_config_cache;
      process.env.npm_config_cache = join(src, '.npm-cache');
      mkdirSync(join(src, 'dist'), { recursive: true });
      writeFileSync(
        join(src, 'package.json'),
        JSON.stringify({ name: PKG, version: '99.0.0', bin: { scenri: 'dist/index.js' }, files: ['dist'] }),
      );
      writeFileSync(
        join(src, 'dist', 'index.js'),
        `#!/usr/bin/env node\nif (process.argv[2] === 'verify') console.log(JSON.stringify({ ok: true, version: '99.0.0' }));\n`,
      );
      const tarball = join(src, execFileSync('npm', ['pack', '--loglevel=error'], { cwd: src }).toString().trim());

      const res = await stageVersion({ home, pkg: PKG, source: { from: tarball } });
      expect(res).toMatchObject({ ok: true, version: '99.0.0' });
      expect(listStaged(home, PKG)).toEqual(['99.0.0']);
      if (prevCache === undefined) delete process.env.npm_config_cache;
      else process.env.npm_config_cache = prevCache;
      rmSync(src, { recursive: true, force: true });
    },
    60_000,
  );
});
