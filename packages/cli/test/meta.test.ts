import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMeta, repoSlug } from '../src/meta.js';

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

describe('runtime package identity', () => {
  it('reads name, version and repository from the adjacent package.json', () => {
    const meta = readMeta();
    expect(meta.name).toBe('scenri');
    expect(meta.version).toBe(pkg.version);
    expect(meta.repository).toBe(pkg.repository.url);
  });

  it('derives owner/repo from the git+https repository url', () => {
    expect(repoSlug('git+https://github.com/tonygorb/scenri.git')).toBe('tonygorb/scenri');
  });

  it('derives owner/repo from a plain https url', () => {
    expect(repoSlug('https://github.com/acme/fork')).toBe('acme/fork');
  });

  it('is undefined for non-github or missing repositories', () => {
    expect(repoSlug(undefined)).toBeUndefined();
    expect(repoSlug('https://gitlab.com/a/b')).toBeUndefined();
  });
});
