import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDesktop, removeDesktop, desktopStatus, type InstallDeps } from '../src/desktop/install.js';
import { LAUNCHER_SCHEMA, launcherDir, readLauncherRecord } from '../src/desktop/paths.js';

/**
 * Installing the desktop launcher writes two things: support files under
 * ~/.scenri/launcher, and one artifact on the Desktop (a .app on macOS, a .lnk
 * on Windows). The Desktop is the user's; nothing there is overwritten unless
 * it is ours, and nothing but ours is ever removed.
 */

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'launcher');

let root: string;
let desktop: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sc-inst-'));
  desktop = join(root, 'Desktop');
  mkdirSync(desktop);
});
afterEach(() => {
  try {
    chmodSync(desktop, 0o755);
  } catch {
    /* gone */
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

type Call = { cmd: string; args: string[]; env: Record<string, string | undefined> };

function deps(platform: NodeJS.Platform, over: Partial<InstallDeps> = {}): InstallDeps & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    platform,
    homedir: root,
    home: join(root, 'data'),
    execPath: platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : join(root, 'bin', 'node'),
    env: { SCENRI_DESKTOP_DIR: desktop, SCENRI_PORT: '4801', PATH: '/bin' },
    version: '0.8.4',
    assetsDir,
    runImpl: async (cmd, args, opts) => {
      calls.push({ cmd, args, env: (opts?.env ?? {}) as Record<string, string> });
      return '';
    },
    calls,
    ...over,
  };
}

describe('installDesktop on macOS', () => {
  it('writes the support files and a Scenri.app with the real icon, no path inside the script', async () => {
    const d = deps('darwin');
    const res = await installDesktop(d);
    expect(res).toEqual({ ok: true, kind: 'macos-app', path: join(desktop, 'Scenri.app') });

    const support = launcherDir(root);
    for (const f of ['launch.mjs', 'starting.html', 'Scenri.icns', 'scenri.ico', 'launcher.json', 'node-path']) {
      expect(existsSync(join(support, f)), f).toBe(true);
    }
    expect(readFileSync(join(support, 'launch.mjs'))).toEqual(readFileSync(join(assetsDir, 'launch.mjs')));
    expect(readFileSync(join(support, 'node-path'), 'utf8')).toBe(`${d.execPath}\n`);

    const app = join(desktop, 'Scenri.app', 'Contents');
    const plist = readFileSync(join(app, 'Info.plist'), 'utf8');
    expect(plist).toContain('<string>co.scenri.desktop-launcher</string>');
    expect(plist).toContain('<key>LSUIElement</key>');
    expect(plist).toContain('<string>Scenri.icns</string>');
    expect(readFileSync(join(app, 'PkgInfo'), 'utf8')).toBe('APPL????');
    const script = readFileSync(join(app, 'MacOS', 'Scenri'), 'utf8');
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
    expect(script).toContain('launch.mjs');
    // the script is a constant: no path, no version, nothing from this machine
    expect(script).not.toContain(root);
    expect(script).not.toContain(d.execPath);
    expect(statSync(join(app, 'MacOS', 'Scenri')).mode & 0o111).toBe(0o111);
    expect(readFileSync(join(app, 'Resources', 'Scenri.icns'))).toEqual(readFileSync(join(assetsDir, 'Scenri.icns')));
    expect(JSON.parse(readFileSync(join(app, 'Resources', 'scenri-launcher.json'), 'utf8'))).toMatchObject({
      schema: LAUNCHER_SCHEMA,
    });

    expect(readLauncherRecord(root)).toEqual({
      schema: LAUNCHER_SCHEMA,
      createdBy: '0.8.4',
      home: join(root, 'data'),
      nodePath: d.execPath,
      env: { SCENRI_PORT: '4801' },
      artifact: { kind: 'macos-app', path: join(desktop, 'Scenri.app') },
    });
    expect(d.calls).toEqual([]);
  });

  it('is idempotent: a second install rewrites ours to the same bytes', async () => {
    const d = deps('darwin');
    await installDesktop(d);
    const script = join(desktop, 'Scenri.app', 'Contents', 'MacOS', 'Scenri');
    writeFileSync(script, '#!/bin/sh\necho tampered\n');
    expect(await installDesktop(d)).toMatchObject({ ok: true });
    expect(readFileSync(script, 'utf8')).not.toContain('tampered');
  });

  it('refuses to touch a Scenri.app that is not ours', async () => {
    const foreign = join(desktop, 'Scenri.app', 'Contents');
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, 'theirs.txt'), 'keep');
    const res = await installDesktop(deps('darwin'));
    expect(res).toMatchObject({ ok: false, reason: 'collision' });
    expect((res as { message: string }).message).toContain('Something else named Scenri is already on your desktop');
    expect(readFileSync(join(foreign, 'theirs.txt'), 'utf8')).toBe('keep');
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'names the macOS privacy setting when the Desktop cannot be written',
    async () => {
      chmodSync(desktop, 0o500);
      const res = await installDesktop(deps('darwin'));
      expect(res).toMatchObject({ ok: false, reason: 'desktop-denied' });
      expect((res as { message: string }).message).toContain('Privacy & Security');
    },
  );
});

describe('installDesktop on Windows', () => {
  it('creates Scenri.lnk through the shell COM object with every value in the environment', async () => {
    const d = deps('win32', {
      runImpl: async (cmd, args, opts) => {
        d.calls.push({ cmd, args, env: (opts?.env ?? {}) as Record<string, string> });
        if (args.join(' ').includes('CreateShortcut') && opts?.env?.SCENRI_TARGET) writeFileSync(opts.env.SCENRI_LNK as string, 'lnk');
        return '';
      },
    });
    const res = await installDesktop(d);
    expect(res).toEqual({ ok: true, kind: 'windows-lnk', path: join(desktop, 'Scenri.lnk') });
    const create = d.calls.find((c) => c.args.join(' ').includes('CreateShortcut'));
    expect(create).toBeDefined();
    expect(create?.cmd).toBe('powershell.exe');
    expect(create?.args).toContain('-NoProfile');
    expect(create?.args).toContain('-NonInteractive');
    expect(create?.args).not.toContain('-EncodedCommand');
    const command = create?.args.join(' ') ?? '';
    // constant script: no path, no user name, no version reaches PowerShell as syntax
    expect(command).not.toContain(root);
    expect(command).not.toContain('node.exe');
    expect(command).toContain('WindowStyle = 7');
    const support = launcherDir(root);
    expect(create?.env).toMatchObject({
      SCENRI_LNK: join(desktop, 'Scenri.lnk'),
      SCENRI_TARGET: d.execPath,
      SCENRI_ARGS: `"${join(support, 'launch.mjs')}"`,
      SCENRI_WORKDIR: support,
      SCENRI_ICON: `${join(support, 'scenri.ico')},0`,
    });
    expect(existsSync(join(support, 'node-path'))).toBe(false);
    expect(readLauncherRecord(root)?.artifact).toEqual({ kind: 'windows-lnk', path: join(desktop, 'Scenri.lnk') });
  });

  it('reads an existing Scenri.lnk before replacing it, and refuses one that is not ours', async () => {
    writeFileSync(join(desktop, 'Scenri.lnk'), 'theirs');
    const d = deps('win32', {
      runImpl: async (cmd, args, opts) => {
        d.calls.push({ cmd, args, env: (opts?.env ?? {}) as Record<string, string> });
        if (args.join(' ').includes('CreateShortcut') && !opts?.env?.SCENRI_TARGET) return 'C:\\Games\\scenri.exe\n--fullscreen\n';
        return '';
      },
    });
    const res = await installDesktop(d);
    expect(res).toMatchObject({ ok: false, reason: 'collision' });
    expect(readFileSync(join(desktop, 'Scenri.lnk'), 'utf8')).toBe('theirs');
    expect(d.calls.some((c) => c.env.SCENRI_TARGET)).toBe(false);
  });

  it('replaces a Scenri.lnk that points at our bootstrap', async () => {
    writeFileSync(join(desktop, 'Scenri.lnk'), 'ours-old');
    const support = launcherDir(root);
    const d = deps('win32', {
      runImpl: async (cmd, args, opts) => {
        d.calls.push({ cmd, args, env: (opts?.env ?? {}) as Record<string, string> });
        if (args.join(' ').includes('CreateShortcut') && !opts?.env?.SCENRI_TARGET) {
          return `C:\\old\\node.exe\n"${join(support, 'launch.mjs')}"\n`;
        }
        if (opts?.env?.SCENRI_TARGET) writeFileSync(opts.env.SCENRI_LNK as string, 'ours-new');
        return '';
      },
    });
    expect(await installDesktop(d)).toMatchObject({ ok: true });
    expect(readFileSync(join(desktop, 'Scenri.lnk'), 'utf8')).toBe('ours-new');
  });
});

describe('installDesktop elsewhere', () => {
  it('fails gracefully on an unsupported platform and writes nothing', async () => {
    const res = await installDesktop(deps('linux'));
    expect(res).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(existsSync(launcherDir(root))).toBe(false);
    expect(existsSync(join(desktop, 'Scenri.app'))).toBe(false);
  });
});

describe('removeDesktop', () => {
  it('deletes only the launcher it made and its support files', async () => {
    const d = deps('darwin');
    await installDesktop(d);
    writeFileSync(join(desktop, 'Scenri.txt'), 'my notes');
    mkdirSync(join(desktop, 'Scenri copy.app'));
    const res = await removeDesktop(d);
    expect(res).toMatchObject({ removed: true, path: join(desktop, 'Scenri.app') });
    expect(existsSync(join(desktop, 'Scenri.app'))).toBe(false);
    expect(existsSync(launcherDir(root))).toBe(false);
    expect(readFileSync(join(desktop, 'Scenri.txt'), 'utf8')).toBe('my notes');
    expect(existsSync(join(desktop, 'Scenri copy.app'))).toBe(true);
  });

  it('leaves a Scenri.app that is not ours, even at the recorded path', async () => {
    const d = deps('darwin');
    await installDesktop(d);
    rmSync(join(desktop, 'Scenri.app'), { recursive: true });
    mkdirSync(join(desktop, 'Scenri.app', 'Contents'), { recursive: true });
    const res = await removeDesktop(d);
    expect(res).toMatchObject({ removed: false });
    expect(existsSync(join(desktop, 'Scenri.app', 'Contents'))).toBe(true);
    expect(existsSync(launcherDir(root))).toBe(false);
  });

  it('is quiet when nothing was ever installed', async () => {
    expect(await removeDesktop(deps('darwin'))).toMatchObject({ removed: false });
  });
});

describe('desktopStatus', () => {
  it('reports not installed, then installed, then missing when the icon is deleted by hand', async () => {
    const d = deps('darwin');
    expect(await desktopStatus(d)).toMatchObject({ supported: true, platform: 'darwin', installed: false, path: null });
    await installDesktop(d);
    expect(await desktopStatus(d)).toMatchObject({ installed: true, path: join(desktop, 'Scenri.app'), current: true });
    rmSync(join(desktop, 'Scenri.app'), { recursive: true });
    const gone = await desktopStatus(d);
    expect(gone).toMatchObject({ installed: false, path: null });
    expect(gone.record).not.toBeNull();
  });

  it('is unsupported on Linux and stale when the recorded node is gone', async () => {
    expect(await desktopStatus(deps('linux'))).toMatchObject({ supported: false, installed: false });
    const d = deps('darwin');
    await installDesktop(d);
    expect((await desktopStatus({ ...d, execPath: join(root, 'elsewhere', 'node') })).current).toBe(false);
  });
});
