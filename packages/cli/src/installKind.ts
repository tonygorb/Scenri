/**
 * Where this build came from, judged by where it runs from. Decides which
 * update story the UI tells (a checkout gets git guidance, never an Update
 * button that would overwrite someone's working tree) and whether the desktop
 * launcher has an installed build to adopt. Node builtins only: the desktop
 * command asks this before anything heavy loads.
 */
import { realpathSync } from 'node:fs';
import { join, sep } from 'node:path';

export type InstallKind = 'dev' | 'managed' | 'npx' | 'global' | 'unknown';

export function detectInstallKind(entryPath: string, home: string): InstallKind {
  if (!entryPath.includes(`${sep}dist${sep}`) && !entryPath.endsWith(`${sep}dist`)) return 'dev';
  // Module paths arrive realpathed; SCENRI_HOME may travel through a symlink
  // (macOS /tmp does), so compare like with like.
  let homeReal = home;
  try {
    homeReal = realpathSync(home);
  } catch {
    /* a home that does not exist yet cannot hold a managed install */
  }
  if (entryPath.startsWith(join(homeReal, 'app', 'versions') + sep)) return 'managed';
  if (entryPath.includes(`${sep}_npx${sep}`)) return 'npx';
  if (entryPath.includes(`${sep}node_modules${sep}`)) return 'global';
  return 'unknown';
}
