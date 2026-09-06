import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDesktop, type InstallDeps } from '../src/desktop/install.js';
import { refreshLauncher } from '../src/desktop/refresh.js';
import { LAUNCHER_SCHEMA, launcherDir, readLauncherRecord, writeLauncherRecord } from '../src/desktop/paths.js';
import { entryOf } from '../src/update/versionsDir.js';

/**
 * Every normal start looks at the launcher once and quietly brings it up to
 * date: a new bootstrap or icon, a node that moved, a newer build to adopt.
 * It never creates what the user deleted and never rewrites what they chose.
 */

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'launcher');

let root: string;
let desktop: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sc-refresh-'));
  desktop = join(root, 'Desktop');
  mkdirSync(desktop);
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin', 'node'), '');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function deps(over: Partial<InstallDeps & { ownEntry: string; installKind: 'npx' | 'managed'; pkg: string }> = {}) {
  const calls: { env: Record<string, string | undefined> }[] = [];
  return {
    platform: 'darwin' as NodeJS.Platform,
    homedir: root,
    home: join(root, 'data'),
    execPath: join(root, 'bin', 'node'),
    env: { SCENRI_DESKTOP_DIR: desktop, SCENRI_PORT: '4801' } as NodeJS.ProcessEnv,
    version: '0.8.4',
    assetsDir,
    runImpl: async (_cmd: string, _args: string[], opts?: { env?: NodeJS.ProcessEnv }) => {
      calls.push({ env: (opts?.env ?? {}) as Record<string, string> });
      return '';
    },
    ownEntry: '/x/app/versions/0.8.4/node_modules/scenri/dist/index.js',
    installKind: 'managed' as const,
    pkg: 'scenri',
    calls,
    ...over,
  };
}

const bundleIcon = () => join(desktop, 'Scenri.app', 'Contents', 'Resources', 'Scenri.icns');
const supportFile = (f: string) => join(launcherDir(root), f);

describe('refreshLauncher', () => {
  it('does nothing when no launcher was ever installed, or when told not to', async () => {
    expect(await refreshLauncher(deps())).toEqual({});
    expect(existsSync(launcherDir(root))).toBe(false);
    const d = deps();
    await installDesktop(d);
    expect(await refreshLauncher({ ...d, env: { ...d.env, SCENRI_NO_DESKTOP: '1' } })).toEqual({});
  });

  it('leaves a current install untouched', async () => {
    const d = deps();
    await installDesktop(d);
    const before = readLauncherRecord(root);
    expect(await refreshLauncher(d)).toEqual({});
    expect(readLauncherRecord(root)).toEqual(before);
  });

  it('rewrites the support files and the icon on a schema change, keeping the recorded env and home', async () => {
    const d = deps();
    await installDesktop(d);
    const record = readLauncherRecord(root);
    if (!record) throw new Error('no record');
    writeLauncherRecord(root, { ...record, schema: LAUNCHER_SCHEMA - 1, createdBy: '0.7.0' });
    writeFileSync(supportFile('launch.mjs'), '// old bootstrap');
    writeFileSync(bundleIcon(), 'old icon');
    expect(await refreshLauncher(d)).toEqual({ refreshed: true });
    expect(readFileSync(supportFile('launch.mjs'))).toEqual(readFileSync(join(assetsDir, 'launch.mjs')));
    expect(readFileSync(bundleIcon())).toEqual(readFileSync(join(assetsDir, 'Scenri.icns')));
    expect(readLauncherRecord(root)).toEqual({ ...record, schema: LAUNCHER_SCHEMA, createdBy: '0.8.4' });
  });

  it('refreshes a stale bootstrap or icon even on the same schema', async () => {
    const d = deps();
    await installDesktop(d);
    writeFileSync(supportFile('starting.html'), '<!-- old -->');
    expect(await refreshLauncher(d)).toEqual({ refreshed: true });
    expect(readFileSync(supportFile('starting.html'))).toEqual(readFileSync(join(assetsDir, 'starting.html')));
    writeFileSync(bundleIcon(), 'old icon');
    expect(await refreshLauncher(d)).toEqual({ refreshed: true });
    expect(readFileSync(bundleIcon())).toEqual(readFileSync(join(assetsDir, 'Scenri.icns')));
  });

  it('never recreates an icon the user deleted', async () => {
    const d = deps();
    await installDesktop(d);
    rmSync(join(desktop, 'Scenri.app'), { recursive: true });
    const record = readLauncherRecord(root);
    if (!record) throw new Error('no record');
    writeLauncherRecord(root, { ...record, schema: LAUNCHER_SCHEMA - 1 });
    await refreshLauncher(d);
    expect(existsSync(join(desktop, 'Scenri.app'))).toBe(false);
    expect(readFileSync(supportFile('launch.mjs'))).toEqual(readFileSync(join(assetsDir, 'launch.mjs')));
  });

  it('points at the running node only once the recorded one is gone', async () => {
    const d = deps();
    await installDesktop(d);
    const other = join(root, 'bin', 'node2');
    writeFileSync(other, '');
    // a different node, but the recorded one still exists: an nvm switch, not a move
    expect(await refreshLauncher({ ...d, execPath: other })).toEqual({});
    expect(readFileSync(supportFile('node-path'), 'utf8')).toBe(`${d.execPath}\n`);
    rmSync(d.execPath);
    expect(await refreshLauncher({ ...d, execPath: other })).toEqual({ refreshed: true });
    expect(readFileSync(supportFile('node-path'), 'utf8')).toBe(`${other}\n`);
    expect(readLauncherRecord(root)?.nodePath).toBe(other);
  });

  it('rewrites a Windows shortcut when its node is gone', async () => {
    const d = deps({ platform: 'win32', execPath: join(root, 'bin', 'node') });
    d.runImpl = async (_cmd, args, opts) => {
      d.calls.push({ env: (opts?.env ?? {}) as Record<string, string> });
      if (opts?.env?.SCENRI_TARGET) writeFileSync(opts.env.SCENRI_LNK as string, 'lnk');
      return '';
    };
    await installDesktop(d);
    const writes = () => d.calls.filter((c) => c.env.SCENRI_TARGET);
    expect(writes()).toHaveLength(1);
    rmSync(d.execPath);
    const other = join(root, 'bin', 'node2');
    writeFileSync(other, '');
    expect(await refreshLauncher({ ...d, execPath: other })).toEqual({ refreshed: true });
    expect(writes()).toHaveLength(2);
    expect(writes()[1].env.SCENRI_TARGET).toBe(other);
  });

  it('adopts a newer build that runs from the npx cache', async () => {
    const nm = join(root, '_npx', 'h', 'node_modules');
    mkdirSync(join(nm, 'scenri', 'dist'), { recursive: true });
    mkdirSync(join(nm, 'fastify'), { recursive: true });
    writeFileSync(join(nm, 'scenri', 'package.json'), JSON.stringify({ name: 'scenri', version: '0.8.4' }));
    writeFileSync(join(nm, 'scenri', 'dist', 'index.js'), '');
    const d = deps({ installKind: 'npx', ownEntry: join(nm, 'scenri', 'dist', 'index.js') });
    await installDesktop(d);
    rmSync(join(d.home, 'app'), { recursive: true, force: true });
    expect(await refreshLauncher(d)).toEqual({ adopted: true });
    expect(existsSync(entryOf(d.home, 'scenri', '0.8.4'))).toBe(true);
    expect(await refreshLauncher(d)).toEqual({});
  });
});
