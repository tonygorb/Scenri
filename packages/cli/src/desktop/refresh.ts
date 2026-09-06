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
import { type InstallDeps, writeSupportFiles } from './install.js';
import { isOurMacBundle, writeMacBundle } from './macos.js';
import { LAUNCHER_SCHEMA, launcherDir, readLauncherRecord, writeLauncherRecord } from './paths.js';
import { writeLnk } from './windows.js';

const ASSETS = ['launch.mjs', 'Scenri.icns', 'scenri.ico'] as const;

export async function refreshLauncher(
  deps: InstallDeps & { ownEntry: string; installKind: InstallKind; pkg: string; verifyImpl?: VerifyImpl },
): Promise<{ adopted?: true; refreshed?: true }> {
  if (deps.env.SCENRI_NO_DESKTOP === '1') return {};
  const record = readLauncherRecord(deps.homedir);
  if (!record) return {};
  const out: { adopted?: true; refreshed?: true } = {};

  if (deps.installKind === 'npx' || deps.installKind === 'global') {
    const newest = newestStaged(deps.home, deps.pkg);
    if (!newest || compareSemver(deps.version, newest) > 0) {
      const r = await adoptRunningInstall({
        home: deps.home,
        pkg: deps.pkg,
        version: deps.version,
        ownEntry: deps.ownEntry,
        installKind: deps.installKind,
        verifyImpl: deps.verifyImpl,
      });
      if (r.adopted) out.adopted = true;
    }
  }

  const support = launcherDir(deps.homedir);
  const artifact = record.artifact.path;
  const ours = existsSync(artifact) && (record.artifact.kind === 'macos-app' ? isOurMacBundle(artifact) : true);
  const schemaStale = record.schema !== LAUNCHER_SCHEMA;
  const supportStale = ASSETS.some((f) => !sameFile(join(support, f), join(deps.assetsDir, f)));
  const nodeGone = !existsSync(record.nodePath);
  const iconStale =
    ours &&
    record.artifact.kind === 'macos-app' &&
    !sameFile(join(artifact, 'Contents', 'Resources', 'Scenri.icns'), join(deps.assetsDir, 'Scenri.icns'));
  const nodePath = nodeGone ? deps.execPath : record.nodePath;

  if (schemaStale || supportStale || nodeGone) {
    writeSupportFiles({ assetsDir: deps.assetsDir, execPath: nodePath, platform: deps.platform }, support);
  }
  if (ours && record.artifact.kind === 'macos-app' && (schemaStale || iconStale)) {
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
  if (schemaStale || supportStale || nodeGone || iconStale) {
    writeLauncherRecord(deps.homedir, { ...record, schema: LAUNCHER_SCHEMA, createdBy: deps.version, nodePath });
    out.refreshed = true;
  }
  return out;
}

function sameFile(a: string, b: string): boolean {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}
