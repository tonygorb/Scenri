import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LAUNCHER_SCHEMA,
  launcherDir,
  logsDir,
  readLauncherRecord,
  writeLauncherRecord,
  recordedEnv,
  desktopDir,
  type LauncherRecord,
} from '../src/desktop/paths.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sc-dpaths-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const record = (over: Partial<LauncherRecord> = {}): LauncherRecord => ({
  schema: LAUNCHER_SCHEMA,
  createdBy: '0.8.4',
  home: '/Users/t/.scenri',
  nodePath: '/opt/homebrew/bin/node',
  env: {},
  artifact: { kind: 'macos-app', path: '/Users/t/Desktop/Scenri.app' },
  ...over,
});

describe('launcher support paths', () => {
  it('keeps the launcher beside the default home and the logs inside the data home', () => {
    // The .app script can only ever find $HOME/.scenri/launcher, whatever
    // SCENRI_HOME says; the logs follow the library the server actually uses.
    expect(launcherDir('/Users/t')).toBe(join('/Users/t', '.scenri', 'launcher'));
    expect(logsDir('/data/scenri')).toBe(join('/data/scenri', 'logs'));
  });
});

describe('the launcher record', () => {
  it('is null when nothing was ever installed', () => {
    expect(readLauncherRecord(root)).toBeNull();
  });

  it('round-trips through disk', () => {
    writeLauncherRecord(root, record());
    expect(readLauncherRecord(root)).toEqual(record());
    expect(existsSync(join(launcherDir(root), 'launcher.json'))).toBe(true);
  });

  it('treats a corrupt or foreign file as absent rather than throwing', () => {
    mkdirSync(launcherDir(root), { recursive: true });
    writeFileSync(join(launcherDir(root), 'launcher.json'), '{not json');
    expect(readLauncherRecord(root)).toBeNull();
    writeFileSync(join(launcherDir(root), 'launcher.json'), JSON.stringify({ hello: 1 }));
    expect(readLauncherRecord(root)).toBeNull();
  });
});

describe('recordedEnv', () => {
  it('keeps only the two settings the icon has to replay', () => {
    expect(recordedEnv({ SCENRI_PORT: '4800', SCENRI_HOST: '0.0.0.0', SCENRI_HOME: '/x', PATH: '/bin' })).toEqual({
      SCENRI_PORT: '4800',
      SCENRI_HOST: '0.0.0.0',
    });
    expect(recordedEnv({})).toEqual({});
  });
});

describe('desktopDir', () => {
  const never = async () => {
    throw new Error('should not run a command');
  };

  it('is ~/Desktop on macOS without asking anything', async () => {
    expect(await desktopDir({ platform: 'darwin', env: {}, homedir: '/Users/t', runImpl: never })).toBe(
      join('/Users/t', 'Desktop'),
    );
  });

  it('asks the Known Folder API on Windows, so a redirected or OneDrive Desktop is honoured', async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const runImpl = async (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return 'C:\\Users\\t\\OneDrive\\Desktop\r\n';
    };
    const dir = await desktopDir({ platform: 'win32', env: {}, homedir: 'C:\\Users\\t', runImpl });
    expect(dir).toBe('C:\\Users\\t\\OneDrive\\Desktop');
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('powershell.exe');
    expect(calls[0].args).toContain('-NoProfile');
    expect(calls[0].args.join(' ')).toContain("GetFolderPath('Desktop')");
  });

  it('lets SCENRI_DESKTOP_DIR override the lookup, for tests and odd setups', async () => {
    expect(await desktopDir({ platform: 'win32', env: { SCENRI_DESKTOP_DIR: '/tmp/d' }, homedir: '/h', runImpl: never })).toBe(
      '/tmp/d',
    );
  });

  it('is null on an unsupported platform', async () => {
    expect(await desktopDir({ platform: 'linux', env: {}, homedir: '/h', runImpl: never })).toBeNull();
  });
});
