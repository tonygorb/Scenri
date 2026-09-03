import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PERF_ROOT = process.env.SCENRI_PERF_ROOT || join(homedir(), '.scenri-perf');
export const RESULTS_DIR = join(PERF_ROOT, 'results');

/** `<ISO ts>-<tier>-<label>-<sha>[-dirty].<kind>.json` plus a sibling markdown table. Never inside the repo. */
export function writeResult(result, markdown) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const stem = `${ts}-${result.tier}-${result.label}-${result.env.sha ?? 'nosha'}${result.env.dirty ? '-dirty' : ''}.${result.kind}`;
  const jsonPath = join(RESULTS_DIR, `${stem}.json`);
  writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  const mdPath = join(RESULTS_DIR, `${stem}.md`);
  writeFileSync(mdPath, markdown);
  return { jsonPath, mdPath };
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else out[key] = true;
    } else out._.push(a);
  }
  return out;
}
