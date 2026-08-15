import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The package's own identity, read from the package.json npm always ships one
 * directory above this module — src/ in dev, dist/ when published. No
 * build-time constant: one code path everywhere, and forks inherit their own
 * name/repository without touching code.
 */
export type Meta = { name: string; version: string; repository: string | undefined };

export function readMeta(): Meta {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
  const repository = typeof raw.repository === 'string' ? raw.repository : raw.repository?.url;
  return { name: raw.name, version: raw.version, repository };
}

/** "git+https://github.com/owner/repo.git" → "owner/repo"; non-GitHub → undefined. */
export function repoSlug(repository: string | undefined): string | undefined {
  const m = repository?.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : undefined;
}
