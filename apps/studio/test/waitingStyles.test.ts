import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');
const files = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(f) ? [p] : [];
  });
const css = files(join(SRC, 'styles'), /\.css$/).map((p) => ({ p, text: readFileSync(p, 'utf8') }));
const rules = css.flatMap(({ p, text }) =>
  [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    file: p,
    selector: m[1].trim(),
    body: m[2],
  })),
);

/**
 * Waiting has one language (DESIGN.md, Waiting): a still placeholder for what
 * exists and has not painted, a moving band for what is being made, and
 * neither in gold. These hold the parts of it a refactor could quietly undo.
 */
describe('the waiting language', () => {
  it('has no gold shimmer left anywhere in the studio', () => {
    const code = files(SRC, /\.(tsx?|css)$/).filter((p) => readFileSync(p, 'utf8').includes('sc-shimmer'));
    expect(code).toEqual([]);
  });

  it('never wears gold on a waiting surface', () => {
    const waiting = /running|urgent|meter|sending|skeleton|rendering|placeholder|wait|refskeleton/;
    const gold = rules.filter((r) => waiting.test(r.selector) && /--sc-gold/.test(r.body));
    expect(gold.map((r) => `${r.file}: ${r.selector}`)).toEqual([]);
  });

  it('moves the band by transform alone and breathes the placeholder by opacity alone', () => {
    const keyframes = css.map((c) => c.text).join('\n');
    const band = keyframes.match(/@keyframes sc-rendering \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const breath = keyframes.match(/@keyframes sc-wait-breathe \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(band).toContain('transform');
    expect(band).not.toMatch(/background|width|left|opacity/);
    expect(breath).toContain('opacity');
    expect(breath).not.toMatch(/background|transform|width/);
  });

  it('stills both under reduced motion', () => {
    const primitives = css.find((c) => c.p.endsWith('primitives.css'))?.text ?? '';
    const reduced = [...primitives.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)]
      .map((m) => m[1])
      .join('\n');
    expect(reduced).toMatch(/\.sc-placeholder::after \{\s*animation: none;/);
    expect(reduced).toMatch(/\.sc-rendering::after \{\s*animation: none;/);
  });

  // Lost once (4ab3beee): without its own box, the band of a shot still being
  // made spread over the whole open-shot stage.
  it("gives the stage's waiting place a box of its own, from the shot's shape", () => {
    const box = rules.find((r) => r.selector === '.sc-stage-wait');
    expect(box?.body).toMatch(/position: relative/);
    expect(box?.body).toMatch(/aspect-ratio: var\(--sc-wait-ar/);
    expect(box?.body).toMatch(/overflow: hidden/);
  });
});
