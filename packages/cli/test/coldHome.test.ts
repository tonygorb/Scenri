import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COLD_MARKER, freshHome, refuseHome } from '../scripts/cold-home.mjs';

/**
 * pnpm cold-start deletes and recreates a Scenri home on every run, so its one
 * rule is what keeps that from ever reaching the real library: only inside
 * the checkout's .scenri-cold, never through a link, never at or around
 * ~/.scenri, and never a directory it did not make.
 */
let root: string;
let cold: string;
let real: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sc-cold-'));
  cold = join(root, 'checkout', '.scenri-cold');
  real = join(root, 'user', '.scenri');
  mkdirSync(cold, { recursive: true });
  mkdirSync(join(real, 'content'), { recursive: true });
  writeFileSync(join(real, 'content', 'meta.json'), '{"version":3}');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the cold-start home', () => {
  it('is accepted inside .scenri-cold', () => {
    expect(refuseHome(join(cold, 'home'), cold, real)).toBeNull();
  });

  it('is refused at the real library, around it, or outside .scenri-cold', () => {
    expect(refuseHome(real, cold, real)).toMatch(/not inside/);
    expect(refuseHome(join(root, 'elsewhere'), cold, real)).toMatch(/not inside/);
    expect(refuseHome(cold, cold, real)).toMatch(/not inside/);
    // a .scenri-cold that is itself inside the real library
    const inside = join(real, 'x', '.scenri-cold');
    mkdirSync(inside, { recursive: true });
    expect(refuseHome(join(inside, 'home'), inside, real)).toMatch(/real library/);
  });

  it('is refused through a link, to the library or its content', () => {
    symlinkSync(real, join(cold, 'home'));
    expect(refuseHome(join(cold, 'home'), cold, real)).toMatch(/is a link/);
    rmSync(join(cold, 'home'));
    mkdirSync(join(cold, 'home'));
    symlinkSync(join(real, 'content'), join(cold, 'home', 'content'));
    expect(refuseHome(join(cold, 'home'), cold, real)).toMatch(/is a link/);
    expect(existsSync(join(real, 'content', 'meta.json'))).toBe(true);
  });

  it('deletes only a home it made, and leaves the real library alone', () => {
    const home = join(cold, 'home');
    mkdirSync(home);
    writeFileSync(join(home, 'someone-elses.db'), '');
    expect(() => freshHome(home, cold, real)).toThrow(/not made by the cold-start helper/);
    expect(existsSync(join(home, 'someone-elses.db'))).toBe(true);

    rmSync(home, { recursive: true });
    freshHome(home, cold, real);
    expect(existsSync(join(home, COLD_MARKER))).toBe(true);
    writeFileSync(join(home, 'scenri.db'), '');
    freshHome(home, cold, real);
    expect(existsSync(join(home, 'scenri.db'))).toBe(false);
    expect(existsSync(join(real, 'content', 'meta.json'))).toBe(true);
  });
});
