import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CORE_VIEWS,
  DEPENDS,
  EXTRA_VIEWS,
  VIEWS,
  VIEW_ROLES,
  autoFor,
} from '../src/create/presenter/presenterStudioRules.js';

/**
 * Two copies of the view table, one truth.
 *
 * The server owns what a view IS: what it is drawn from, whether it is built
 * by default, whether a person decides it. The studio needs the same six rows
 * to draw a strip and write a sentence, and has no dependency on any Scenri
 * package by design, so it keeps its own copy. Before this test the list lived
 * in five places with nothing but a comment saying they matched, and a demote
 * or a new dependency changed on one side alone would have shipped.
 *
 * The technique is searchParity.test.ts's: read both sources and compare. It
 * asserts the rows were actually found before it compares them, because a
 * regex that matches nothing agrees with everything.
 */
const here = fileURLToPath(import.meta.url);
const read = (p: string) => readFileSync(resolve(here, '..', '..', p), 'utf8');
const SERVER = read('../../packages/cli/src/presenterPrompts.ts');
const WIRE = read('src/apiTypes.ts');

interface Row {
  id: string;
  tier: string;
  gate: boolean;
  from: string[];
}

/** The server's VIEW_ROLES rows, read off the source rather than imported. */
const serverRows = (src: string): Row[] => {
  const table = src.slice(src.indexOf('export const VIEW_ROLES'), src.indexOf('const idsWhere'));
  return [
    ...table.matchAll(/\{\s*id:\s*'([^']+)',\s*tier:\s*'([^']+)',\s*(gate:\s*true,\s*)?from:\s*\[([^\]]*)\]/g),
  ].map((m) => ({
    id: m[1],
    tier: m[2],
    gate: !!m[3],
    from: [...m[4].matchAll(/'([^']+)'/g)].map((f) => f[1]),
  }));
};

const studioRows: Row[] = VIEW_ROLES.map((r) => ({
  id: r.id,
  tier: r.tier,
  gate: r.gate === true,
  from: r.from,
}));

describe('the two copies of the presenter view table', () => {
  it('hold the same six rows, in the same order, saying the same things', () => {
    const server = serverRows(SERVER);
    // The guard first: six rows really were parsed out of the server file.
    expect(server).toHaveLength(6);
    expect(studioRows).toHaveLength(6);
    expect(studioRows).toEqual(server);
  });

  it('the wire type lists the same ids in the same order', () => {
    const union = /export type PresenterDraftView =\s*([^;]+);/.exec(WIRE)?.[1] ?? '';
    const ids = [...union.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(ids).toHaveLength(6);
    expect(ids).toEqual(VIEWS);
  });

  it('row order is the only order: core, then supplementary, both in table order', () => {
    expect([...CORE_VIEWS, ...EXTRA_VIEWS].sort()).toEqual([...VIEWS].sort());
    // and each list keeps the table's order rather than inventing one
    expect(CORE_VIEWS).toEqual(VIEWS.filter((v) => CORE_VIEWS.includes(v)));
    expect(EXTRA_VIEWS).toEqual(VIEWS.filter((v) => EXTRA_VIEWS.includes(v)));
  });

  it('a view is never drawn from one that comes after it', () => {
    for (const v of VIEWS) {
      for (const dep of DEPENDS[v]) expect(VIEWS.indexOf(dep)).toBeLessThan(VIEWS.indexOf(v));
    }
  });

  it('the gate is data: a gated view decides by hand, every other view decides itself', () => {
    for (const r of VIEW_ROLES) expect(autoFor(r.id)).toBe(r.gate ? undefined : 'auto');
  });
});
