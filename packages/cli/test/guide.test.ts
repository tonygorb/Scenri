import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core } from '@scenri/core';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { learnGuide, readGuide, stampGuide } from '../src/routes/guide.js';

const brand = (name: string) => ({ specVersion: '0.1', meta: { name } });

describe('first-use guide record', () => {
  let home: string;
  let core: Core;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sc-guide-'));
    core = createCore(home);
  });

  afterEach(() => {
    core.close();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('a home with no brands at its first boot is eligible', () => {
    stampGuide(core.store);
    expect(readGuide(core.store, {})).toEqual({ eligible: true, learned: [] });
  });

  it('a home that already has a brand at that boot is not', () => {
    core.store.createBrand(brand('Existing'));
    stampGuide(core.store);
    expect(readGuide(core.store, {})).toEqual({ eligible: false, learned: [] });
  });

  it('stamps once: brands created or deleted later never change it', () => {
    stampGuide(core.store);
    const b = core.store.createBrand(brand('First'));
    stampGuide(core.store);
    expect(readGuide(core.store, {}).eligible).toBe(true);
    core.store.deleteBrand(b.id);
    stampGuide(core.store);
    expect(readGuide(core.store, {}).eligible).toBe(true);
  });

  it('an upgraded home never becomes eligible after its brands go', () => {
    const b = core.store.createBrand(brand('Existing'));
    stampGuide(core.store);
    core.store.deleteBrand(b.id);
    stampGuide(core.store);
    expect(readGuide(core.store, {}).eligible).toBe(false);
  });

  it('SCENRI_NO_GUIDE=1 reads as not eligible without touching the record', () => {
    stampGuide(core.store);
    expect(readGuide(core.store, { SCENRI_NO_GUIDE: '1' }).eligible).toBe(false);
    expect(readGuide(core.store, {}).eligible).toBe(true);
  });

  it('learning is idempotent and keeps order of arrival', () => {
    stampGuide(core.store);
    learnGuide(core.store, 'refine');
    learnGuide(core.store, 'tour-create');
    learnGuide(core.store, 'refine');
    expect(readGuide(core.store, {}).learned).toEqual(['refine', 'tour-create']);
  });

  it('a corrupt record reads as not eligible rather than throwing', () => {
    core.store.setSetting('guide', '{not json');
    expect(readGuide(core.store, {})).toEqual({ eligible: false, learned: [] });
    learnGuide(core.store, 'refine');
    expect(readGuide(core.store, {})).toEqual({ eligible: false, learned: ['refine'] });
  });
});

describe('guide routes', () => {
  let home: string;
  let core: Core;
  let app: FastifyInstance;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sc-guide-api-'));
    core = createCore(home);
    app = buildServer({ core, engines: { all: () => [], get: () => null } });
  });

  afterEach(async () => {
    await app.drain();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('boot stamps a fresh home, and a learned concept is remembered', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/guide' });
    expect(first.json()).toEqual({ eligible: true, learned: [] });
    const post = await app.inject({ method: 'POST', url: '/api/guide/learned', payload: { concept: 'tour-create' } });
    expect(post.statusCode).toBe(200);
    expect(post.json()).toEqual({ eligible: true, learned: ['tour-create'] });
    const again = await app.inject({ method: 'GET', url: '/api/guide' });
    expect(again.json().learned).toEqual(['tour-create']);
  });

  it('refuses a concept it does not know', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/guide/learned', payload: { concept: 'tour' } });
    expect(res.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/guide' })).json().learned).toEqual([]);
  });
});
