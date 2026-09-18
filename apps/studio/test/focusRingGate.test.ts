import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The focus doctrine (foundations/interaction.css): a control rings for the
 * keyboard, never after a click. Every rule that answers `:focus-visible`
 * carries the modality prefix, except the places to type, which always show
 * where the caret is. A new rule without it would bring back the ring a menu
 * leaves on its trigger when it closes.
 */
const STYLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles');
const GATE = ':where(:root:not([data-input="pointer"]))';
const FIELDS = new Set([
  '.sc-in:focus-visible',
  '.sc-cap-in .sc-in:focus-visible',
  '.sc-cp-hex:focus-visible',
  '.sc-edit:focus-visible',
]);
/** Search boxes ring their wrapper while the caret is inside: a place to type. */
const FIELD_WRAPPERS = new Set(['.sc-assets-search', '.sc-swap-search', '.sc-menu-find']);

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? cssFiles(p) : p.endsWith('.css') ? [p] : [];
  });
}

/** Rule selectors, comments removed, one entry per comma-separated selector. */
function selectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  const re = /([^{};]+)\{/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const prelude = m[1].trim();
    if (prelude.startsWith('@')) continue;
    let depth = 0;
    let cur = '';
    for (const ch of prelude) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
  }
  return out;
}

const outsideNot = (sel: string) => sel.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '');

describe('the focus ring answers the keyboard', () => {
  const files = cssFiles(STYLES).filter((f) => !f.endsWith('tokens.css') && !f.endsWith('interaction.css'));

  it('every component :focus-visible rule carries the modality prefix, fields aside', () => {
    const bare: string[] = [];
    for (const f of files)
      for (const sel of selectors(readFileSync(f, 'utf8'))) {
        if (!outsideNot(sel).includes(':focus-visible')) continue;
        if (sel.startsWith(GATE) || FIELDS.has(sel)) continue;
        bare.push(`${relative(STYLES, f)}: ${sel}`);
      }
    expect(bare).toEqual([]);
  });

  it('no button is ringed through :focus-within, which a click also matches', () => {
    const rings: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of text.matchAll(/([^{};]+):focus-within\s*\{([^}]*)\}/g)) {
        const sel = m[1].trim();
        if (FIELD_WRAPPERS.has(sel)) continue;
        if (/outline\s*:\s*var\(--sc-ring-w\)/.test(m[2])) rings.push(`${relative(STYLES, f)}: ${sel}`);
      }
    }
    expect(rings).toEqual([]);
  });

  it('the floor itself is split by hand, and Radix Themes controls stay quiet after a click', () => {
    const floor = readFileSync(join(STYLES, 'foundations', 'interaction.css'), 'utf8').replace(/\s+/g, ' ');
    expect(floor).toContain(`${GATE} :where( button,`);
    expect(floor).toContain(':where([data-input="pointer"]) :is(.rt-BaseButton, .rt-SelectTrigger):focus-visible');
  });
});
