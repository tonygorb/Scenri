import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileDirection, compileItems } from '../src/create/presenter/presenterFlowRules.js';
import type { Answers } from '../src/create/presenter/presenterQuestions.js';

/**
 * What the flow asks the draft to hold is exactly what the draft stores.
 *
 * The flow compares the two to decide whether the draft is in step, and asks
 * once when it is not. Text the server stores differently can never be in
 * step: the flow stepped over it, and then asked again with a redraw of the
 * face the moment one landed. The server's rule is `str()` in
 * `packages/cli/src/presenterDrafts.ts`: trim, then cap.
 */
const server = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'cli', 'src', 'presenterDrafts.ts'),
  'utf8',
);
const cap = (re: RegExp): number => {
  const m = re.exec(server);
  if (!m) throw new Error(`the server no longer says ${re}`);
  return Number(m[1]);
};
const ITEM = cap(/const KEEP_ITEM_CHARS = (\d+)/);
const DIRECTION = cap(/str\(patch\.direction, (\d+)\)/);
const str = (v: string, max: number) => v.trim().slice(0, max);

const tapped = (keep: string): Answers => ({
  source: { door: 'scratch', via: 'taps' },
  'look-who': { pick: 'woman' },
  'look-age': { pick: '30s' },
  'look-hair': { pick: 'brown' },
  'look-length': { pick: 'long' },
  'look-skin': { pick: 'olive' },
  'look-build': { pick: 'lean' },
  'look-heritage': { pick: 'Mediterranean' },
  'look-eyes': { pick: 'green' },
  'look-height': { pick: 'average height' },
  traits: [],
  keep: { words: keep, refs: [] },
});

describe('the words a draft holds', () => {
  it('reads the caps off the server', () => {
    expect(ITEM).toBe(200);
    expect(cap(/str\(input\.direction, (\d+)\)/)).toBe(DIRECTION);
  });

  it('an item cut on a space is stored as it was sent', () => {
    const keep = `${'a small silver hoop in the left ear '.repeat(8)}`;
    // the cut lands on a space, which the server trims after the client cut
    expect(keep.trim()[ITEM - 1]).toBe(' ');
    for (const item of compileItems(tapped(keep))) expect(str(item.words, ITEM)).toBe(item.words);
  });

  it('a direction past the cap is stored as it was sent', () => {
    const long = `${'a quiet, composed woman who looks straight at the camera and '.repeat(12)}smiles`;
    const answers: Answers = { source: { door: 'scratch', via: 'typed' }, describe: long, gaps: 'skipped' };
    const direction = compileDirection(answers);
    expect(direction.length).toBeLessThanOrEqual(DIRECTION);
    expect(str(direction, DIRECTION)).toBe(direction);
  });
});
