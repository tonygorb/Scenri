/**
 * Where the desktop launcher keeps its support files.
 *
 * The launcher dir sits beside the *default* home, never inside SCENRI_HOME:
 * the .app on a Mac Desktop is a constant script that can only ever find
 * $HOME/.scenri/launcher, whatever env the terminal had. The record inside it
 * remembers which data home to boot. Logs follow that data home, next to the
 * library they describe, and both live outside app/ so `rm -rf ~/.scenri/app`
 * stays the safe recovery it is documented to be.
 *
 * The bootstrap imports nothing from here (it is a frozen file of its own),
 * but the same layout is spelled out there. Node builtins only.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Bump when launch.mjs, the record shape, or the artifact templates change. */
export const LAUNCHER_SCHEMA = 1;

export interface LauncherRecord {
  schema: number;
  /** The Scenri version that wrote the files. */
  createdBy: string;
  /** The data home the icon boots (SCENRI_HOME at install time). */
  home: string;
  /** process.execPath at install time; the icon's first choice of node. */
  nodePath: string;
  /** The env the icon replays: SCENRI_PORT and SCENRI_HOST, when set. */
  env: Record<string, string>;
  artifact: { kind: 'macos-app' | 'windows-lnk'; path: string };
}

export const launcherDir = (homedir: string): string => join(homedir, '.scenri', 'launcher');
export const logsDir = (home: string): string => join(home, 'logs');
export const launcherRecordPath = (homedir: string): string => join(launcherDir(homedir), 'launcher.json');

/** The record, or null when there is none, or it is not ours to read. */
export function readLauncherRecord(homedir: string): LauncherRecord | null {
  try {
    const raw = JSON.parse(readFileSync(launcherRecordPath(homedir), 'utf8')) as Partial<LauncherRecord>;
    if (
      typeof raw?.schema !== 'number' ||
      typeof raw.home !== 'string' ||
      typeof raw.nodePath !== 'string' ||
      typeof raw.artifact?.path !== 'string'
    ) {
      return null;
    }
    return raw as LauncherRecord;
  } catch {
    return null;
  }
}

/** Atomic: a crash mid-write leaves the old record, never half of a new one. */
export function writeLauncherRecord(homedir: string, record: LauncherRecord): void {
  const path = launcherRecordPath(homedir);
  mkdirSync(launcherDir(homedir), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(tmp, path);
}

const REPLAYED = ['SCENRI_PORT', 'SCENRI_HOST'] as const;

/** The two settings that change which server the icon should find. */
export function recordedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of REPLAYED) if (env[key]) out[key] = env[key] as string;
  return out;
}

/** Runs an executable with an argv array and resolves its stdout. Never a shell. */
export type RunImpl = (cmd: string, args: string[], opts?: { env?: NodeJS.ProcessEnv }) => Promise<string>;

// Windows PowerShell 5.1 is on every supported Windows; inline -Command is not
// gated by the script execution policy, and nothing here is interpolated.
const KNOWN_FOLDER_DESKTOP = "[Environment]::GetFolderPath('Desktop')";

/**
 * The user's Desktop folder. macOS keeps it at ~/Desktop (the display name is
 * localised, the path is not). Windows may redirect it, localise it or move it
 * into OneDrive, and only the Known Folder API knows where it went.
 */
export async function desktopDir(deps: {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homedir: string;
  runImpl: RunImpl;
}): Promise<string | null> {
  if (deps.env.SCENRI_DESKTOP_DIR) return deps.env.SCENRI_DESKTOP_DIR;
  if (deps.platform === 'darwin') return join(deps.homedir, 'Desktop');
  if (deps.platform === 'win32') {
    const out = await deps.runImpl('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      KNOWN_FOLDER_DESKTOP,
    ]);
    const dir = out.trim();
    return dir || null;
  }
  return null;
}

export const isSupportedPlatform = (platform: NodeJS.Platform): boolean =>
  platform === 'darwin' || platform === 'win32';

/** True once the launcher dir holds a record; the artifact is checked separately. */
export const launcherInstalled = (homedir: string): boolean => existsSync(launcherRecordPath(homedir));
