import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(PKG, '..', '..');

// npm renders the shipped README against the package's repository directory
// (packages/cli), so a repo-root-relative link 404s on npmjs.com even though
// it works on GitHub. The only link that survives both renderers is an
// absolute one. Checked at the tracked sources: prepack.mjs copies the root
// README and docs/ASSETS-LICENSE.md into the tarball verbatim.
const SHIPPED_MD = [
  join(ROOT, 'README.md'),
  join(ROOT, 'docs', 'ASSETS-LICENSE.md'),
  join(PKG, 'CHANGELOG.md'),
];

describe('the npm-facing markdown', () => {
  it('carries no relative links, which 404 on npmjs.com', () => {
    for (const file of SHIPPED_MD) {
      const text = readFileSync(file, 'utf8');
      const targets = [...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
      const relative = targets.filter((t) => !/^(https?:|#|mailto:)/.test(t));
      expect(relative, `${file} links that would break on npm`).toEqual([]);
    }
  });
});
