// Reminder, not an oracle. Reads docs/impact.md and names the public-doc areas
// whose path prefixes overlap the files changed since a base (default: the last tag).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function parseMap(markdown) {
  const rules = [];
  for (const line of markdown.split('\n')) {
    const match = line.match(/^- ([^:]+):\s*(.+)$/);
    if (!match) continue;
    const area = match[1].trim();
    const prefixes = match[2]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (prefixes.length) rules.push({ area, prefixes });
  }
  return rules;
}

export function areasFor(files, rules) {
  const hit = [];
  for (const rule of rules) {
    const matched = files.filter((file) => rule.prefixes.some((prefix) => file === prefix || file.startsWith(prefix)));
    if (matched.length) hit.push({ area: rule.area, files: matched });
  }
  return hit;
}

function lines(args) {
  const out = execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function changedFiles(base) {
  const names = new Set([
    ...lines(['diff', '--name-only', `${base}...HEAD`]),
    ...lines(['diff', '--name-only', 'HEAD']),
    ...lines(['ls-files', '--others', '--exclude-standard']),
  ]);
  return [...names].sort();
}

function lastTag() {
  return execFileSync('git', ['describe', '--tags', '--abbrev=0'], { cwd: root, encoding: 'utf8' }).trim();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const baseFlag = process.argv.indexOf('--base');
  const base = baseFlag === -1 ? lastTag() : process.argv[baseFlag + 1];
  if (!base) {
    console.error('docs-impact: --base needs a ref');
    process.exit(1);
  }
  const rules = parseMap(readFileSync(path.join(root, 'docs/impact.md'), 'utf8'));
  const files = changedFiles(base);
  const hits = areasFor(files, rules);
  if (hits.length === 0) {
    console.log(`No path match since ${base}.`);
    console.log('This is not a clearance. If the behavior is unchanged, record: No public docs impact: <reason>');
  } else {
    console.log(`Potential docs impact: ${hits.map((h) => h.area).join(', ')}`);
    for (const hit of hits) {
      for (const file of hit.files) console.log(`  ${hit.area}: ${file}`);
    }
    console.log('Review the pages. A path match is not proof the words changed.');
  }
}
