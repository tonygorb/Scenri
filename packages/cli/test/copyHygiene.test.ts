import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// The public prose surface (DESIGN.md §6, "Writing"). Deliberately absent:
// CHANGELOG.md (generated), LICENSE/NOTICE/CLA/CODE_OF_CONDUCT (legal or
// adapted text), templates/**/*.json (creative prompt text, byte-locked by
// the showcase golden fixture).
const FILES = [
  'README.md',
  'ROADMAP.md',
  'DESIGN.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'PRIVACY.md',
  'TRADEMARKS.md',
  'docs/updates.md',
  'docs/RELEASING.md',
  'docs/ASSETS-LICENSE.md',
  'docs/A11Y-BACKLOG.md',
  'docs/media/README.md',
  'templates/previews/README.md',
  'packages/brand-spec/SPEC.md',
  'packages/brand-spec/README.md',
  '.github/pull_request_template.md',
  ...readdirSync(join(ROOT, '.github/ISSUE_TEMPLATE'))
    .filter((f) => f.endsWith('.yml'))
    .map((f) => `.github/ISSUE_TEMPLATE/${f}`),
];

const LONG_DASH = /[–—]/;
/**
 * The product is Scenri; `scenri` is an identifier (DESIGN.md §6, "Writing").
 * Anything machine-addressable is spelled inside a code span or a fence, both
 * of which are stripped before this runs, so a bare lowercase hit left in
 * prose is always the name written wrong. The two lookaheads keep `scenri.co`
 * out while letting a sentence end on the word.
 */
const BARE_NAME = /(^|[^@/._\-~:a-zA-Z0-9])scenri(?![/_\-:@a-zA-Z0-9])(?!\.[a-zA-Z0-9])/;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/u;

describe('public copy hygiene', () => {
  // A missing listed file throws in readFileSync, which keeps the list honest.
  it.each(FILES)('%s carries no long dashes or emoji', (rel) => {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
    for (const [i, line] of lines.entries()) {
      expect(LONG_DASH.test(line), `${rel}:${i + 1} has a long dash`).toBe(false);
      expect(EMOJI.test(line), `${rel}:${i + 1} has emoji`).toBe(false);
    }
  });

  it.each(FILES)('%s spells the product Scenri', (rel) => {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
    let fenced = false;
    for (const [i, line] of lines.entries()) {
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        continue;
      }
      if (fenced) continue;
      const prose = line.replace(/`[^`]*`/g, '');
      expect(BARE_NAME.test(prose), `${rel}:${i + 1} writes scenri where the name goes`).toBe(false);
    }
  });
});
