/**
 * `scenri update` — the one obvious manual path when the in-app button cannot
 * run (unsupervised serve, an old launcher, broken clipboard, taste). Stages
 * only; whatever is newest runs on the next start.
 */
import { readMeta } from '../meta.js';
import { fetchDistTagLatest } from './check.js';
import { findNpm, stageVersion } from './stage.js';
import { compareSemver, defaultHome, newestStaged } from './versionsDir.js';

export async function runUpdateCommand(opts: { check: boolean; from?: string }): Promise<number> {
  const meta = readMeta();
  const home = defaultHome();

  if (opts.from) {
    console.log(`  staging from ${opts.from}…`);
    const res = await stageVersion({
      home,
      pkg: meta.name,
      source: { from: opts.from },
      keep: new Set([meta.version]),
    });
    if (res.ok) {
      console.log(`  staged ${res.version}. It runs on the next start.`);
      return 0;
    }
    console.error(`  staging failed (${res.reason}): ${res.detail}`);
    return 1;
  }

  const { latest, error } = await fetchDistTagLatest(meta.name);
  if (error) {
    console.error(`  could not reach the registry: ${error}`);
    return 1;
  }
  if (!latest) {
    console.log(`  ${meta.name} has no published releases to update to.`);
    return 0;
  }

  const staged = newestStaged(home, meta.name);
  const effective = staged && compareSemver(staged, meta.version) > 0 ? staged : meta.version;
  console.log(`  running ${meta.version}${staged ? ` · staged ${staged}` : ''} · latest ${latest}`);

  if (compareSemver(latest, effective) <= 0) {
    console.log(staged ? '  the newest version is already staged. Just start Scenri.' : '  already the newest.');
    return 0;
  }
  if (opts.check) {
    console.log(`  ${latest} is available. Stage it with: scenri update`);
    return 0;
  }
  if (!findNpm()) {
    console.error('  npm is not reachable from here, so nothing can be downloaded.');
    console.error('  Run the newest version directly with: npx scenri@latest');
    console.error('  (or install Node.js with npm and try again)');
    return 1;
  }

  console.log(`  downloading ${meta.name} ${latest}…`);
  const res = await stageVersion({
    home,
    pkg: meta.name,
    source: { version: latest },
    keep: new Set([meta.version]),
  });
  if (res.ok) {
    console.log(`  staged ${res.version} and verified it loads. It runs on the next start.`);
    return 0;
  }
  console.error(`  update failed (${res.reason}): ${res.detail}`);
  return 1;
}
