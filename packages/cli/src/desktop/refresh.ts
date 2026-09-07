/**
 * Every normal start looks at the launcher once and brings it up to date
 * without asking: a new bootstrap, page or icon in this version, a recorded
 * node that no longer exists, a newer build to adopt from the npx cache. It
 * never creates an icon the user deleted and never rewrites the env or the
 * home they installed with. Cheap when nothing changed: a handful of stats
 * and small file compares.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InstallKind } from '../installKind.js';
import { compareSemver, newestStaged } from '../update/versionsDir.js';
import { adoptRunningInstall, type VerifyImpl } from './adopt.js';
import { type InstallDeps, runningNodeMajor, stableExecPath, writeSupportFiles } from './install.js';
import { MAC_SCRIPT, isOurMacBundle, macPlist, writeMacBundle } from './macos.js';
import { LAUNCHER_SCHEMA, launcherDir, readLauncherRecord, writeLauncherRecord } from './paths.js';
import { writeLnk } from './windows.js';

const ASSETS = ['launch.mjs', 'Scenri.icns', 'scenri.ico'] as const;

export async function refreshLauncher(
  deps: InstallDeps & { ownEntry: string; installKind: InstallKind; pkg: string; verifyImpl?: VerifyImpl },
): Promise<{ adopted?: true; refreshed?: true }> {
  if (deps.env.SCENRI_NO_DESKTOP === '1') return {};
  // A source checkout carries its own launcher assets and version number, so
  // letting it "refresh" an installed icon would push an unreleased bootstrap
  // onto the user's Desktop from whichever checkout happened to start. Only a
  // built install keeps the icon current.
  if (deps.installKind === 'dev') return {};
  const record = readLauncherRecord(deps.homedir);
  if (!record) return {};
  const out: { adopted?: true; refreshed?: true } = {};

  const running = runningNodeMajor();
  const ownNode = stableExecPath(deps.execPath, deps.platform);
  const nodeGone = !existsSync(record.nodePath);
  // The icon runs on the recorded node. When that is the node running now, or
  // it is gone and this one takes over, a different major means the copy's
  // native modules were built for a node that is no longer there: rebuild the
  // copy from the running build. A different node that still exists is left
  // alone, because the icon's node and its copy still agree.
  const majorChanged =
    (nodeGone ||
      samePath(record.nodePath, ownNode, deps.platform) ||
      samePath(record.nodePath, deps.execPath, deps.platform)) &&
    record.nodeMajor !== undefined &&
    record.nodeMajor !== running;

  let rebuilt = false;
  if (deps.installKind === 'npx' || deps.installKind === 'global') {
    const newest = newestStaged(deps.home, deps.pkg);
    const newer = !newest || compareSemver(deps.version, newest) > 0;
    const rebuild = majorChanged && newest !== null && compareSemver(deps.version, newest) >= 0;
    if (newer || rebuild) {
      const r = await adoptRunningInstall({
        home: deps.home,
        pkg: deps.pkg,
        version: deps.version,
        ownEntry: deps.ownEntry,
        installKind: deps.installKind,
        verifyImpl: deps.verifyImpl,
        force: rebuild,
      });
      if (r.adopted) {
        out.adopted = true;
        rebuilt = rebuild;
      }
    }
  }

  const support = launcherDir(deps.homedir);
  const artifact = record.artifact.path;
  const ours = existsSync(artifact) && (record.artifact.kind === 'macos-app' ? isOurMacBundle(artifact) : true);
  const schemaStale = record.schema !== LAUNCHER_SCHEMA;
  const nodePath = nodeGone ? ownNode : record.nodePath;
  // The recorded major describes the copy; it moves only with the copy, or
  // with the node when the recorded one is gone and there is nothing to keep.
  const nodeMajor = nodeGone || rebuilt ? running : (record.nodeMajor ?? running);
  // The two files the .app script reads must agree with the record; a file
  // edited or lost by hand is healed here rather than at the next click.
  const nodeFilesStale =
    deps.platform === 'darwin' &&
    (readText(join(support, 'node-path')) !== `${nodePath}\n` ||
      readText(join(support, 'node-major')) !== `${nodeMajor}\n`);
  const supportStale = nodeFilesStale || ASSETS.some((f) => !sameFile(join(support, f), join(deps.assetsDir, f)));
  const mac = ours && record.artifact.kind === 'macos-app';
  const iconStale =
    mac && !sameFile(join(artifact, 'Contents', 'Resources', 'Scenri.icns'), join(deps.assetsDir, 'Scenri.icns'));
  // The script and plist are this version's text; a release that changes
  // either reaches an installed bundle here, no schema bump needed.
  const bundleStale =
    mac &&
    (readText(join(artifact, 'Contents', 'MacOS', 'Scenri')) !== MAC_SCRIPT ||
      readText(join(artifact, 'Contents', 'Info.plist')) !==
        macPlist({ version: deps.version, schema: LAUNCHER_SCHEMA }));

  if (schemaStale || supportStale || nodeGone) {
    writeSupportFiles({ assetsDir: deps.assetsDir, execPath: nodePath, platform: deps.platform, nodeMajor }, support);
  }
  if (mac && (schemaStale || iconStale || bundleStale)) {
    writeMacBundle({
      path: artifact,
      icns: join(support, 'Scenri.icns'),
      version: deps.version,
      schema: LAUNCHER_SCHEMA,
    });
  }
  if (ours && record.artifact.kind === 'windows-lnk' && (schemaStale || nodeGone)) {
    await writeLnk(deps.runImpl, {
      path: artifact,
      target: nodePath,
      args: `"${join(support, 'launch.mjs')}"`,
      workdir: support,
      icon: `${join(support, 'scenri.ico')},0`,
    });
  }
  if (schemaStale || supportStale || nodeGone || iconStale || bundleStale || rebuilt) {
    writeLauncherRecord(deps.homedir, {
      ...record,
      schema: LAUNCHER_SCHEMA,
      createdBy: deps.version,
      nodePath,
      nodeMajor,
    });
    out.refreshed = true;
  }
  return out;
}

/** Windows paths differ in case alone; everywhere else a path is its bytes. */
function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function sameFile(a: string, b: string): boolean {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}
