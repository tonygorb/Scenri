import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { loadShowcase, showcaseFacetsOf, type ShowcaseEntry } from '../src/showcase.js';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

const base: ShowcaseEntry = {
  id: 'ok',
  title: 'Ok',
  category: 'beauty',
  brief: { tokens: [{ t: 'text', v: 'a shot' }] },
  width: 10,
  height: 10,
};

describe('showcase loader', () => {
  it('loads valid entries and skips bad files with a warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sc-showcase-'));
    writeFileSync(join(dir, 'ok.json'), JSON.stringify(base));
    writeFileSync(join(dir, 'bad.json'), '{nope');
    writeFileSync(join(dir, 'incomplete.json'), JSON.stringify({ id: 'x' }));
    writeFileSync(
      join(dir, 'badtoken.json'),
      JSON.stringify({ ...base, id: 'badtoken', brief: { tokens: [{ t: 'nonsense' }] } }),
    );
    const { showcase, warnings } = loadShowcase(dir);
    expect(showcase.map((s) => s.id)).toEqual(['ok']);
    expect(warnings).toHaveLength(3);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports the categories actually in use, sorted', () => {
    const { categories } = showcaseFacetsOf([base, { ...base, id: 'two', category: 'footwear' }]);
    expect(categories).toEqual(['beauty', 'footwear']);
  });
});

describe('showcase catalog API', () => {
  let templatesDir: string;
  let home: string;
  let core: Core;
  let app: FastifyInstance;

  const spy: EngineAdapter = {
    capabilities: () => ({
      id: 'spy',
      displayName: 'Spy',
      localOnly: false,
      supportsEdit: true,
      supportsMask: false,
      maxReferenceImages: 2,
    }),
    isAvailable: async () => ({ ok: true }),
    costEstimate: async () => 0,
    generate: async () => ({ images: [], costUsd: 0 }),
    edit: async () => ({ images: [], costUsd: 0 }),
  };

  beforeEach(async () => {
    templatesDir = mkdtempSync(join(tmpdir(), 'sc-showcase-templates-'));
    mkdirSync(join(templatesDir, 'showcase'), { recursive: true });
    writeFileSync(
      join(templatesDir, 'showcase', 'amber-serum.json'),
      JSON.stringify({ ...base, id: 'amber-serum', title: 'Amber Serum on Salt Flat' }),
    );
    mkdirSync(join(templatesDir, 'previews', 'showcase'), { recursive: true });
    const jpg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffddaa' } })
      .jpeg()
      .toBuffer();
    writeFileSync(join(templatesDir, 'previews', 'showcase', 'amber-serum.jpg'), jpg);

    home = mkdtempSync(join(tmpdir(), 'sc-showcase-home-'));
    core = createCore(home);
    app = buildServer({
      core,
      engines: { all: () => [spy], get: (id) => (id === 'spy' ? spy : null) },
      templatesDir,
    });
  });

  afterEach(async () => {
    await app.close();
    core.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(templatesDir, { recursive: true, force: true });
  });

  it('lists the catalog with facets and a preview url', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/showcase' });
    const body = res.json();
    expect(body.showcase).toHaveLength(1);
    expect(body.showcase[0].title).toBe('Amber Serum on Salt Flat');
    expect(body.showcase[0].previewUrl).toMatch(/^\/api\/showcase-previews\/amber-serum\.jpg\?v=\d+$/);
    expect(body.categories).toContain('beauty');
  });

  it('serves the preview image and 404s an unknown one', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/showcase-previews/amber-serum.jpg' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    const missing = await app.inject({ method: 'GET', url: '/api/showcase-previews/nope.jpg' });
    expect(missing.statusCode).toBe(404);
  });
});
