import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core } from '@scenri/core';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { learnGuide, readGuide, restartGuide, stampGuide } from '../src/routes/guide.js';

const brand = (name: string) => ({ specVersion: '0.1', meta: { name } });
const V = '1.2.0';

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
    stampGuide(core.store, V);
    expect(readGuide(core.store, {})).toEqual({ eligible: true, learned: [], optedIn: false });
  });

  it('a home that already has a brand at that boot is not', () => {
    core.store.createBrand(brand('Existing'));
    stampGuide(core.store, V);
    expect(readGuide(core.store, {})).toEqual({ eligible: false, learned: [], optedIn: false });
  });

  it('stamps once: brands created or deleted later never change it', () => {
    stampGuide(core.store, V);
    const b = core.store.createBrand(brand('First'));
    stampGuide(core.store, V);
    expect(readGuide(core.store, {}).eligible).toBe(true);
    core.store.deleteBrand(b.id);
    stampGuide(core.store, V);
    expect(readGuide(core.store, {}).eligible).toBe(true);
  });

  it('an upgraded home never becomes eligible after its brands go', () => {
    const b = core.store.createBrand(brand('Existing'));
    stampGuide(core.store, V);
    core.store.deleteBrand(b.id);
    stampGuide(core.store, V);
    expect(readGuide(core.store, {}).eligible).toBe(false);
  });

  it("a new home has already read its install version's notes", () => {
    stampGuide(core.store, V);
    expect(core.store.getSetting('whatsnew.seen')).toBe(V);
    expect(core.store.getSetting('install.firstVersion')).toBe(V);
  });

  it('a brandless home first opened on an older build is caught up, and keeps the version it first ran', () => {
    core.store.setSetting('install.firstVersion', '1.0.0');
    core.store.setSetting('whatsnew.seen', '1.0.0');
    stampGuide(core.store, V);
    expect(readGuide(core.store, {}).eligible).toBe(true);
    expect(core.store.getSetting('whatsnew.seen')).toBe(V);
    expect(core.store.getSetting('install.firstVersion')).toBe('1.0.0');
  });

  it('a home with brands keeps its unread notes', () => {
    core.store.createBrand(brand('Existing'));
    core.store.setSetting('whatsnew.seen', '1.0.0');
    stampGuide(core.store, V);
    expect(core.store.getSetting('whatsnew.seen')).toBe('1.0.0');
    expect(core.store.getSetting('install.firstVersion')).toBeNull();
  });

  it('never lowers a newer acknowledgement', () => {
    core.store.setSetting('whatsnew.seen', '2.0.0');
    stampGuide(core.store, V);
    expect(core.store.getSetting('whatsnew.seen')).toBe('2.0.0');
  });

  it('a later boot leaves the notes alone, whatever they say', () => {
    stampGuide(core.store, V);
    core.store.setSetting('whatsnew.seen', '1.0.0');
    stampGuide(core.store, '1.3.0');
    expect(core.store.getSetting('whatsnew.seen')).toBe('1.0.0');
  });

  it('SCENRI_NO_GUIDE=1 reads as not eligible without touching the record', () => {
    stampGuide(core.store, V);
    expect(readGuide(core.store, { SCENRI_NO_GUIDE: '1' }).eligible).toBe(false);
    expect(readGuide(core.store, {}).eligible).toBe(true);
  });

  it('learning is idempotent and keeps order of arrival', () => {
    stampGuide(core.store, V);
    learnGuide(core.store, 'refine');
    learnGuide(core.store, 'tour-create');
    learnGuide(core.store, 'refine');
    expect(readGuide(core.store, {}).learned).toEqual(['refine', 'tour-create']);
  });

  it('starting the tours over clears every tour, keeps the welcome answered and refine learned', () => {
    stampGuide(core.store, V);
    for (const c of ['welcome', 'tour-home', 'tour-skip', 'tours-off', 'refine'] as const) learnGuide(core.store, c);
    restartGuide(core.store);
    expect(readGuide(core.store, {})).toEqual({ eligible: true, learned: ['welcome', 'refine'], optedIn: true });
  });

  it('an upgraded install that asks for the tours is taught, even where tests silence the boot decision', () => {
    core.store.createBrand(brand('Existing'));
    stampGuide(core.store, V);
    expect(readGuide(core.store, { SCENRI_NO_GUIDE: '1' }).eligible).toBe(false);
    restartGuide(core.store);
    expect(readGuide(core.store, { SCENRI_NO_GUIDE: '1' })).toEqual({
      eligible: true,
      learned: ['welcome'],
      optedIn: true,
    });
    learnGuide(core.store, 'tour-home');
    expect(readGuide(core.store, { SCENRI_NO_GUIDE: '1' }).eligible).toBe(true);
  });

  it('a corrupt record reads as not eligible rather than throwing', () => {
    core.store.setSetting('guide', '{not json');
    expect(readGuide(core.store, {})).toEqual({ eligible: false, learned: [], optedIn: false });
    learnGuide(core.store, 'refine');
    expect(readGuide(core.store, {})).toEqual({ eligible: false, learned: ['refine'], optedIn: false });
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
    expect(first.json()).toEqual({ eligible: true, learned: [], optedIn: false });
    const post = await app.inject({ method: 'POST', url: '/api/guide/learned', payload: { concept: 'tour-create' } });
    expect(post.statusCode).toBe(200);
    expect(post.json()).toEqual({ eligible: true, learned: ['tour-create'], optedIn: false });
    const again = await app.inject({ method: 'GET', url: '/api/guide' });
    expect(again.json().learned).toEqual(['tour-create']);
  });

  it('restart answers with the fresh state', async () => {
    await app.inject({ method: 'POST', url: '/api/guide/learned', payload: { concept: 'tours-off' } });
    const res = await app.inject({ method: 'POST', url: '/api/guide/restart' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ eligible: true, learned: ['welcome'], optedIn: true });
  });

  it('refuses a concept it does not know', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/guide/learned', payload: { concept: 'tour' } });
    expect(res.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/guide' })).json().learned).toEqual([]);
  });
});
