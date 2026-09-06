import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entryOf } from '../src/update/versionsDir.js';

/**
 * launcher/launch.mjs is the frozen bootstrap the desktop icon runs. It has
 * one job: find the newest valid version under the recorded home and hand off
 * to `node <entry> open`. These tests run the real file with node against a
 * planted home whose entries are stubs that report how they were invoked.
 */

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOOTSTRAP = join(pkgDir, 'launcher', 'launch.mjs');

let root: string;
let launcher: string;
let home: string;
let probe: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sc-boot-'));
  launcher = join(root, '.scenri', 'launcher');
  home = join(root, 'data');
  probe = join(root, 'probe.json');
  mkdirSync(launcher, { recursive: true });
  copyFileSync(BOOTSTRAP, join(launcher, 'launch.mjs'));
  writeFileSync(
    join(launcher, 'launcher.json'),
    JSON.stringify({
      schema: 1,
      createdBy: '0.8.4',
      home,
      nodePath: process.execPath,
      env: { SCENRI_PORT: '4801' },
      artifact: { kind: 'macos-app', path: '/nowhere' },
    }),
  );
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** A version dir whose entry writes its argv and env to the probe file. */
function plant(version: string, opts: { valid?: boolean } = {}) {
  const entry = entryOf(home, 'scenri', version);
  mkdirSync(dirname(entry), { recursive: true });
  writeFileSync(
    join(dirname(dirname(entry)), 'package.json'),
    JSON.stringify({ name: 'scenri', version: opts.valid === false ? '0.0.0' : version }),
  );
  writeFileSync(
    entry,
    `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.SCENRI_BOOT_PROBE, JSON.stringify({ argv: process.argv.slice(1), home: process.env.SCENRI_HOME, port: process.env.SCENRI_PORT, cwd: process.cwd() }));`,
  );
  return entry;
}

function run(env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [join(launcher, 'launch.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, SCENRI_BOOT_PROBE: probe, SCENRI_NO_DIALOG: '1', ...env },
  });
}

async function probed(): Promise<{ argv: string[]; home: string; port: string; cwd: string }> {
  for (let i = 0; i < 60; i++) {
    if (existsSync(probe)) return JSON.parse(readFileSync(probe, 'utf8'));
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the bootstrap never ran an entry');
}

const launcherLog = () => readFileSync(join(home, 'logs', 'launcher.log'), 'utf8');

describe('the desktop bootstrap', () => {
  it('hands off to the newest valid version with `open`, the recorded home and env', async () => {
    plant('0.8.3');
    const newest = plant('0.8.4');
    plant('0.8.5', { valid: false });
    const res = run();
    expect(res.status).toBe(0);
    const got = await probed();
    expect(got.argv).toEqual([newest, 'open']);
    expect(got.home).toBe(home);
    expect(got.port).toBe('4801');
    expect(launcherLog()).toMatch(/bootstrap v1: handing off to .*0\.8\.4/);
  });

  it('returns at once: the child outlives it', async () => {
    plant('0.8.4');
    const t0 = Date.now();
    const res = run();
    expect(res.status).toBe(0);
    expect(Date.now() - t0).toBeLessThan(5_000);
    await probed();
  });

  it('explains missing app files instead of doing nothing', () => {
    const res = run();
    expect(res.status).toBe(1);
    expect(existsSync(probe)).toBe(false);
    const log = launcherLog();
    expect(log).toContain('no valid version');
    expect(log).toContain("dialog: Scenri's app files are missing. Open a terminal and run: npx scenri");
  });

  it('falls back to the default home when the record is unreadable', () => {
    rmSync(join(launcher, 'launcher.json'));
    const res = run({ HOME: root, USERPROFILE: root });
    expect(res.status).toBe(1);
    expect(readFileSync(join(root, '.scenri', 'logs', 'launcher.log'), 'utf8')).toContain('no valid version');
  });
});
