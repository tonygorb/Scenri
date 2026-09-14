import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/**
 * A `setState` updater must be pure.
 *
 * React calls an updater twice under StrictMode and keeps the SECOND answer,
 * and may replay it again on a re-render. An updater that writes a ref as a
 * side effect therefore reads its own write on the call that counts.
 *
 * This is not theoretical. `ProductLibraryProvider` compared a freshly fetched
 * library against `lastRef.current` inside its updater and recorded the new
 * signature in the same breath:
 *
 *   setState((cur) => {
 *     if (cur.loaded && lastRef.current === text) return cur;  // 2nd call: true
 *     lastRef.current = text;                                  // 1st call wrote it
 *     return { products: r.products, loaded: true };
 *   });
 *
 * The first call recorded the signature and returned the new list; the second
 * saw its own write, took the early return and handed back the OLD state. So
 * every poll during a catalog import threw its own result away and products
 * appeared only after a manual reload - with the network, the server and the
 * poll cadence all measurably correct, which is what made it expensive to find.
 *
 * Reading a ref inside an updater is fine. Writing one is the bug, so that is
 * what this forbids.
 */
const UPDATER = /\bset[A-Z]\w*\(\s*\(?\s*\w+\s*\)?\s*=>\s*\{/g;
const REF_WRITE = /\.current\s*=(?!=)/;

/** The updater's body, from its opening brace to the brace that closes it. */
function body(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

describe('state updaters are pure', () => {
  it('no setState updater writes a ref', () => {
    const offenders: string[] = [];
    for (const file of globSync('**/*.{ts,tsx}', { cwd: SRC })) {
      const src = readFileSync(join(SRC, file), 'utf8');
      for (const m of src.matchAll(UPDATER)) {
        if (!REF_WRITE.test(body(src, m.index + m[0].length - 1))) continue;
        offenders.push(`${relative('.', file)}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('finds the shape it is looking for', () => {
    const sample = 'setState((cur) => {\n  lastRef.current = text;\n  return cur;\n});';
    const m = [...sample.matchAll(UPDATER)][0];
    expect(m).toBeDefined();
    expect(REF_WRITE.test(body(sample, m.index + m[0].length - 1))).toBe(true);
  });
});
