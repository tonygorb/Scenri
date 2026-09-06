/**
 * Installing, repairing, removing and reporting the desktop launcher. Two
 * things get written: support files under ~/.scenri/launcher, and one artifact
 * on the Desktop. The Desktop is the user's: an artifact is replaced only when
 * it is ours, removed only when it is ours, and a name clash is reported, not
 * resolved by renaming anything.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LAUNCHER_SCHEMA,
  type LauncherRecord,
  type RunImpl,
  desktopDir,
  isSupportedPlatform,
  launcherDir,
  readLauncherRecord,
  recordedEnv,
  writeLauncherRecord,
} from './paths.js';
import { isOurMacBundle, writeMacBundle } from './macos.js';
import { isOurLnk, writeLnk } from './windows.js';

export interface InstallDeps {
  platform: NodeJS.Platform;
  /** os.homedir(): where ~/.scenri/launcher lives. */
  homedir: string;
  /** The data home the icon should boot. */
  home: string;
  execPath: string;
  env: NodeJS.ProcessEnv;
  /** The Scenri version doing the writing. */
  version: string;
  /** The package's launcher/ directory. */
  assetsDir: string;
  runImpl: RunImpl;
}

export type InstallResult =
  | { ok: true; kind: 'macos-app' | 'windows-lnk'; path: string }
  | { ok: false; reason: 'unsupported' | 'no-desktop' | 'collision' | 'desktop-denied' | 'failed'; message: string };

export interface DesktopStatus {
  supported: boolean;
  platform: NodeJS.Platform;
  installed: boolean;
  path: string | null;
  /** Installed, on this schema, and pointing at a node that still exists. */
  current: boolean;
  record: LauncherRecord | null;
}

export const UNSUPPORTED = 'Desktop shortcuts are not available on this system yet.';
const NO_DESKTOP = 'Your Desktop folder could not be found.';
const COLLISION = 'Something else named Scenri is already on your desktop. Move or rename it, then try again.';
const DENIED =
  'macOS did not allow writing to your Desktop. Allow it under System Settings > Privacy & Security > Files and Folders, then try again.';

// The starting page is not here: scenri open renders it per launch from the
// package template, and a copy would read as stale to the refresh.
const SUPPORT_FILES = ['launch.mjs', 'Scenri.icns', 'scenri.ico'] as const;

export async function installDesktop(deps: InstallDeps): Promise<InstallResult> {
  if (!isSupportedPlatform(deps.platform)) return { ok: false, reason: 'unsupported', message: UNSUPPORTED };
  const desktop = await desktopDir(deps);
  if (!desktop) return { ok: false, reason: 'no-desktop', message: NO_DESKTOP };

  const darwin = deps.platform === 'darwin';
  const support = launcherDir(deps.homedir);
  const bootstrap = join(support, 'launch.mjs');
  const kind = darwin ? 'macos-app' : 'windows-lnk';
  const artifact = join(desktop, darwin ? 'Scenri.app' : 'Scenri.lnk');

  // Ownership first, before a single byte lands anywhere.
  if (existsSync(artifact)) {
    const ours = darwin ? isOurMacBundle(artifact) : await isOurLnk(deps.runImpl, artifact, bootstrap);
    if (!ours) return { ok: false, reason: 'collision', message: COLLISION };
  }

  const nodeMajor = runningNodeMajor();
  writeSupportFiles({ ...deps, nodeMajor }, support);
  try {
    if (darwin) {
      writeMacBundle({
        path: artifact,
        icns: join(support, 'Scenri.icns'),
        version: deps.version,
        schema: LAUNCHER_SCHEMA,
      });
    } else {
      await writeLnk(deps.runImpl, {
        path: artifact,
        target: deps.execPath,
        args: `"${bootstrap}"`,
        workdir: support,
        icon: `${join(support, 'scenri.ico')},0`,
      });
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (darwin && (code === 'EPERM' || code === 'EACCES'))
      return { ok: false, reason: 'desktop-denied', message: DENIED };
    const detail = err instanceof Error ? err.message.split('\n')[0] : String(err);
    return { ok: false, reason: 'failed', message: `Scenri could not write ${artifact} (${detail}).` };
  }

  writeLauncherRecord(deps.homedir, {
    schema: LAUNCHER_SCHEMA,
    createdBy: deps.version,
    home: deps.home,
    nodePath: deps.execPath,
    nodeMajor,
    env: recordedEnv(deps.env),
    artifact: { kind, path: artifact },
  });
  return { ok: true, kind, path: artifact };
}

/** The support files are ours alone, so they are always rewritten in full. */
export const runningNodeMajor = (): number => Number(process.versions.node.split('.')[0]);

export function writeSupportFiles(
  deps: Pick<InstallDeps, 'assetsDir' | 'execPath' | 'platform'> & { nodeMajor: number },
  support: string,
): void {
  mkdirSync(support, { recursive: true });
  for (const f of SUPPORT_FILES) copyFileSync(join(deps.assetsDir, f), join(support, f));
  if (deps.platform === 'darwin') {
    // Native modules were built for this node; when the recorded path is gone
    // the script prefers another node of the same major over any other.
    writeFileSync(join(support, 'node-path'), `${deps.execPath}\n`);
    writeFileSync(join(support, 'node-major'), `${deps.nodeMajor}\n`);
  }
}

export async function removeDesktop(deps: InstallDeps): Promise<{ removed: boolean; path?: string; message?: string }> {
  const record = readLauncherRecord(deps.homedir);
  const support = launcherDir(deps.homedir);
  let removed = false;
  let message: string | undefined;
  const path = record?.artifact.path;
  if (path && existsSync(path)) {
    const ours =
      record.artifact.kind === 'macos-app'
        ? isOurMacBundle(path)
        : await isOurLnk(deps.runImpl, path, join(support, 'launch.mjs'));
    if (ours) {
      rmSync(path, { recursive: true, force: true });
      removed = true;
    } else {
      message = `${path} is not the launcher Scenri made, so it was left alone.`;
    }
  }
  rmSync(support, { recursive: true, force: true });
  return { removed, path, message };
}

export async function desktopStatus(deps: InstallDeps): Promise<DesktopStatus> {
  const supported = isSupportedPlatform(deps.platform);
  const record = readLauncherRecord(deps.homedir);
  let installed = false;
  let path: string | null = null;
  if (supported && record && existsSync(record.artifact.path)) {
    // A .lnk at the recorded path is taken as ours here: reading it costs a
    // PowerShell round trip, and the install and remove paths still check.
    installed = record.artifact.kind === 'macos-app' ? isOurMacBundle(record.artifact.path) : true;
    path = installed ? record.artifact.path : null;
  }
  const current =
    installed &&
    record !== null &&
    record.schema === LAUNCHER_SCHEMA &&
    (existsSync(record.nodePath) || record.nodePath === deps.execPath);
  return { supported, platform: deps.platform, installed, path, current, record };
}
