import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// The public prose surface (DESIGN.md §6, "Writing"). Deliberately absent:
// CHANGELOG.md (generated), LICENSE/NOTICE/CLA/CODE_OF_CONDUCT (legal or
// adapted text), templates/**/*.json (creative prompt text, byte-locked by
// the showcase golden fixture).
const FILES = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'ROADMAP.md',
  'DESIGN.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'PRIVACY.md',
  'TRADEMARKS.md',
  'docs/INSTALL.md',
  'docs/CONCEPTS.md',
  'docs/FAQ.md',
  'docs/updates.md',
  'docs/RELEASING.md',
  'docs/ASSETS-LICENSE.md',
  'docs/A11Y-BACKLOG.md',
  'docs/brand-marks.md',
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

/**
 * The source that carries prose: comments and the strings people read. Markdown
 * hides its commands in code spans; source hides them in bare literals and in
 * the identifiers the regex above already skips, so those are stripped instead.
 * This file is excluded because it has to spell the thing it forbids.
 */
const SOURCE = globSync(['apps/studio/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'], { cwd: ROOT })
  .map((f) => f.split(sep).join('/'))
  .filter((f) => !f.endsWith('copyHygiene.test.ts'))
  // Published release notes keep the spelling they went out with, the same
  // reason CHANGELOG.md is absent from the list above.
  .filter((f) => !f.endsWith('release/notes.data.ts'))
  .sort();

/**
 * The forms that are the command or the package rather than the name: a bare
 * literal, an invocation, and the left column of the help table in args.ts,
 * where `scenri` is the word you type.
 */
const IDENTIFIER_FORMS =
  /(['"`])scenri\1|npx scenri|scenri (?:serve|update|open|desktop|--version|--help)|^\s+scenri(?=\s{2,})/g;

/**
 * People and Places (0.22). Presenter and Scene are the code's names and stay
 * there (DESIGN.md §6, "Writing"); every string the studio shows says Person,
 * People, Place or Places. Checked in what a person can read: string literals
 * and JSX text, with comments and `${...}` code stripped first. A lowercase hit
 * counts only in a literal with a space in it, which is prose: a bare
 * 'presenter' is a kind, a key or a path segment.
 */
const OLD_TERM = /(?<![-\w/.:$])(?:Presenters?|Scenes?)(?![-\w/])/;
const OLD_TERM_IN_PROSE = /(?<![-\w/.:$])(?:presenters?|scenes?)(?![-\w/=])/;
const STUDIO = SOURCE.filter((f) => f.startsWith('apps/studio/src/'));

function visibleStrings(source: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const code = source.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ''));
  for (const [i, raw] of code.split('\n').entries()) {
    const line = raw.replace(/(^|[^:\\])\/\/.*$/, '$1');
    const literals = line.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
    const jsx = [...line.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]).filter((t) => !/[(=?&|]/.test(t));
    // JSX text wrapped onto a line of its own: words and spaces, nothing a
    // line of code would hold (the way "Edit scene" hid on ScenePage)
    const t = line.trim();
    const bare =
      / /.test(t) &&
      !/[{}<>=;'"`()[\]]|\w\.\w/.test(t) &&
      !/^(type|import|export|const|let|return|case)\b|^\w+\??:|^[?:&|]/.test(t);
    if (bare) jsx.push(t);
    for (const text of [...literals, ...jsx]) out.push({ line: i + 1, text: text.replace(/\$\{[^}]*\}/g, '') });
  }
  return out;
}

/** The public pages, which may name the old words only to say they are old. */
const TERM_DOCS = [
  'README.md',
  'CONTRIBUTING.md',
  'ROADMAP.md',
  ...readdirSync(join(ROOT, 'docs'))
    .filter((f) => /^[A-Z]+\.md$/.test(f))
    .filter((f) => !['RELEASING.md', 'A11Y-BACKLOG.md', 'ASSETS-LICENSE.md'].includes(f))
    .map((f) => `docs/${f}`),
];
const SAYS_IT_IS_OLD = /were called Presenters|Where did Presenters and Scenes go|when they were called Presenters/;

describe('public copy hygiene', () => {
  // A missing listed file throws in readFileSync, which keeps the list honest.
  it.each(FILES)('%s carries no long dashes or emoji', (rel) => {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
    for (const [i, line] of lines.entries()) {
      expect(LONG_DASH.test(line), `${rel}:${i + 1} has a long dash`).toBe(false);
      expect(EMOJI.test(line), `${rel}:${i + 1} has emoji`).toBe(false);
    }
  });

  it('has source files to check, so an empty glob cannot pass silently', () => {
    expect(SOURCE.length).toBeGreaterThan(100);
  });

  it.each(SOURCE)('%s spells the product Scenri', (rel) => {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
    for (const [i, line] of lines.entries()) {
      const prose = line.replace(IDENTIFIER_FORMS, '');
      expect(BARE_NAME.test(prose), `${rel}:${i + 1} writes scenri where the name goes`).toBe(false);
    }
  });

  it.each(STUDIO)('%s says People and Places where a person reads it', (rel) => {
    for (const { line, text } of visibleStrings(readFileSync(join(ROOT, rel), 'utf8'))) {
      const body = text.replace(/^['"`]|['"`]$/g, '');
      const old = OLD_TERM.test(body) || (/\s/.test(body) && OLD_TERM_IN_PROSE.test(body));
      expect(old, `${rel}:${line} shows ${text}`).toBe(false);
    }
  });

  it.each(TERM_DOCS)('%s says People and Places', (rel) => {
    let fenced = false;
    for (const [i, line] of readFileSync(join(ROOT, rel), 'utf8').split('\n').entries()) {
      if (/^\s*```/.test(line)) fenced = !fenced;
      if (fenced || SAYS_IT_IS_OLD.test(line)) continue;
      const prose = line.replace(/`[^`]*`/g, '').replace(/\]\([^)]*\)/g, ']');
      expect(OLD_TERM.test(prose), `${rel}:${i + 1} says Presenter or Scene`).toBe(false);
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
