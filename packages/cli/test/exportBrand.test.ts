import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { createCore, type Core } from '@scenri/core';
import { validateBrand } from '@scenri/brand';
import { buildBrandBundle } from '../src/exportBrand.js';

let home: string;
let core: Core;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-exportbrand-'));
  core = createCore(home);
});
afterEach(() => {
  core.close();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const open = async (buf: Buffer) => JSZip.loadAsync(buf);
const doc = async (zip: JSZip) => JSON.parse(await (zip.file('brand.json') as JSZip.JSZipObject).async('string'));
/** File entries only: JSZip synthesizes a directory entry per folder. */
const names = (zip: JSZip) =>
  Object.values(zip.files)
    .filter((f) => !f.dir)
    .map((f) => f.name)
    .sort();

describe('buildBrandBundle', () => {
  it('rewrites every asset ref to a path the bundle actually contains', async () => {
    const logo = core.images.save(Buffer.from('logo-bytes'));
    const shot = core.images.save(Buffer.from('shot-bytes'));
    const brand = core.store.createBrand({
      specVersion: '0.1',
      meta: { name: 'Acme Coffee' },
      logos: [{ role: 'wordmark', file: `asset:${logo}` }],
      products: [{ id: 'house-blend', name: 'House Blend', shots: [{ file: `asset:${shot}`, angle: 'front' }] }],
    } as any);

    const { zip: buf, filename } = await buildBrandBundle(core, brand.id);
    const zip = await open(buf);
    const json = await doc(zip);

    expect(filename).toBe('acme-coffee.brand');
    expect(json.logos[0].file).toBe('assets/logo-wordmark-1.png');
    expect(json.products[0].shots[0].file).toBe('assets/products/house-blend-front.png');
    for (const path of [json.logos[0].file, json.products[0].shots[0].file]) {
      expect(zip.file(path)).not.toBeNull();
    }
    expect(names(zip)).toContain('README.txt');
  });

  it('writes a shared image once and points both refs at it', async () => {
    const shared = core.images.save(Buffer.from('one-and-the-same'));
    const brand = core.store.createBrand({
      specVersion: '0.1',
      meta: { name: 'Acme' },
      logos: [{ role: 'primary', file: `asset:${shared}` }],
      products: [{ id: 'bag', name: 'Bag', shots: [{ file: `asset:${shared}` }] }],
    } as any);
    const zip = await open((await buildBrandBundle(core, brand.id)).zip);
    const json = await doc(zip);
    expect(json.products[0].shots[0].file).toBe(json.logos[0].file);
    expect(names(zip).filter((n) => n.startsWith('assets/'))).toHaveLength(1);
  });

  // A ref the store has lost is a broken thumbnail here and an unfixable
  // promise in someone else's tool. It must not travel.
  it('drops a dangling ref from its array and says so in the README', async () => {
    const real = core.images.save(Buffer.from('real'));
    const brand = core.store.createBrand({
      specVersion: '0.1',
      meta: { name: 'Acme' },
      logos: [
        { role: 'primary', file: 'asset:00000000000000000000000000000000' },
        { role: 'mark', file: `asset:${real}` },
      ],
      products: [{ id: 'bag', name: 'Bag', shots: [{ file: 'asset:11111111111111111111111111111111' }] }],
    } as any);
    const zip = await open((await buildBrandBundle(core, brand.id)).zip);
    const json = await doc(zip);
    expect(json.logos).toHaveLength(1);
    expect(json.logos[0].role).toBe('mark');
    // A product whose every shot went missing keeps the product, loses the shots
    expect(json.products[0].shots).toBeUndefined();
    expect(json.products[0].name).toBe('Bag');
    expect(await (zip.file('README.txt') as JSZip.JSZipObject).async('string')).toMatch(
      /2 referenced images were missing/,
    );
  });

  it('produces a document that still validates as a .brand', async () => {
    const logo = core.images.save(Buffer.from('logo'));
    const brand = core.store.createBrand({
      specVersion: '0.1',
      meta: { name: 'Acme', website: 'https://acme.coffee' },
      palette: { primary: { hex: '#1F3D2B' } },
      imagery: { mood: 'crafted' },
      rules: { never: ['competitor logos in frame'] },
      logos: [{ role: 'primary', file: `asset:${logo}`, background: 'light' }],
    } as any);
    const json = await doc(await open((await buildBrandBundle(core, brand.id)).zip));
    expect(validateBrand(json).errors).toEqual([]);
    expect(json.rules).toEqual({ never: ['competitor logos in frame'] });
  });

  it('leaves an http asset ref alone — the bare form already travels', async () => {
    const brand = core.store.createBrand({
      specVersion: '0.1',
      meta: { name: 'Acme' },
      logos: [{ role: 'primary', file: 'https://cdn.acme.coffee/logo.svg' }],
    } as any);
    const json = await doc(await open((await buildBrandBundle(core, brand.id)).zip));
    expect(json.logos[0].file).toBe('https://cdn.acme.coffee/logo.svg');
  });

  // A .brand you can commit to a repo is only useful if an unchanged brand
  // exports byte-stable file lists.
  it('is deterministic across exports of an unchanged brand', async () => {
    const a = core.images.save(Buffer.from('a'));
    const b = core.images.save(Buffer.from('b'));
    const brand = core.store.createBrand({
      specVersion: '0.1',
      meta: { name: 'Acme' },
      logos: [
        { role: 'primary', file: `asset:${a}` },
        { role: 'mark', file: `asset:${b}` },
      ],
    } as any);
    const one = names(await open((await buildBrandBundle(core, brand.id)).zip));
    const two = names(await open((await buildBrandBundle(core, brand.id)).zip));
    expect(one).toEqual(two);
    expect(one).toEqual(['README.txt', 'assets/logo-mark-2.png', 'assets/logo-primary-1.png', 'brand.json']);
  });

  it('throws for a brand that is not there', async () => {
    await expect(buildBrandBundle(core, 'nope')).rejects.toThrow(/brand not found/);
  });
});
