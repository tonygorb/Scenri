import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

/**
 * The wire the studio's feed runs on: pages of summaries with counts, one
 * row per shot on demand, the tree around a shot, the brand list without its
 * documents, and derivatives sized for tiles. Architectural, never timed.
 */

let home: string;
let core: Core;
let app: FastifyInstance;

function registryWith(...adapters: EngineAdapter[]) {
  const byId = new Map(adapters.map((a) => [a.capabilities().id, a]));
  return { all: () => adapters, get: (id: string) => byId.get(id) ?? null };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-feed-'));
  core = createCore(home);
  app = buildServer({ core, engines: registryWith(createDemoEngine((b) => core.images.save(b))) });
});
afterEach(async () => {
  await app.drain();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function brandWithShots(n: number) {
  const brand = core.store.createBrand({
    specVersion: '0.1',
    meta: { name: 'Feed Co' },
    products: [{ id: 'p-cup', name: 'Ceramic Mug' }],
  } as any);
  const project = core.store.workspaceFor(brand.id);
  const root = core.store.rootFor(project.id)!;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [node] = core.store.addNodes({
      projectId: project.id,
      parentId: root.id,
      kind: 'generation',
      prompt: `shot number ${['zero', 'one', 'two', 'three', 'four'][i] ?? i} on linen`,
      engineId: 'demo',
      count: 1,
    });
    core.store.setBrief(node.id, { tokens: i % 2 ? [{ t: 'product', id: 'p-cup' }] : [] });
    const png = await sharp({ create: { width: 64 + i, height: 80, channels: 3, background: '#336699' } })
      .png()
      .toBuffer();
    core.store.completeNode(node.id, { images: [core.images.save(png)], costUsd: 0 });
    ids.push(node.id);
  }
  return { brand, project, root, ids };
}

describe('GET /api/brands/:id/feed', () => {
  it('answers one page of summaries with a cursor and the lens counts', async () => {
    const { brand, ids } = await brandWithShots(5);
    const first = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/feed?limit=2` });
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.items.map((n: any) => n.id)).toEqual([ids[4], ids[3]]);
    expect(body.counts).toEqual({ total: 5, all: 5, keepers: 0, archived: 0, ungrouped: 5 });
    for (const n of body.items) {
      expect('prompt' in n).toBe(false);
      expect('overlays' in n).toBe(false);
      expect(typeof n.promptHead).toBe('string');
      expect(n.childCount).toBe(0);
    }
    const second = await app.inject({
      method: 'GET',
      url: `/api/brands/${brand.id}/feed?limit=2&cursor=${encodeURIComponent(body.next)}`,
    });
    expect(second.json().items.map((n: any) => n.id)).toEqual([ids[2], ids[1]]);
    const bad = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/feed?cursor=junk` });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/brands/nope/feed' })).statusCode).toBe(404);
  });

  it('searches the index and the current names of the tokens a brief carries', async () => {
    const { brand, ids } = await brandWithShots(4);
    const byPrompt = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/feed?q=number%20three` });
    expect(byPrompt.json().items.map((n: any) => n.id)).toEqual([ids[3]]);
    // a term under three letters filters no text; the feed narrows on the third
    const short = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/feed?q=qx` });
    expect(short.json().counts.all).toBe(4);
    // "mug" is nowhere in a prompt; it is the product's name, and the odd shots carry the product
    const byName = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/feed?q=mug` });
    expect(byName.json().items.map((n: any) => n.id)).toEqual([ids[3], ids[1]]);
    expect(byName.json().counts.all).toBe(2);
    // the engine's own name finds every shot it made
    const byEngine = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/feed?q=demo` });
    expect(byEngine.json().counts.all).toBe(4);
  });

  it('scopes by set, lens, lineage and token', async () => {
    const { brand, ids } = await brandWithShots(3);
    const set = core.store.createSet(brand.id, 'Press');
    core.store.addToSet(set.id, [ids[0]]);
    core.store.setKept(ids[1], true);
    const inSet = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/feed?set=${set.id}` });
    expect(inSet.json().items.map((n: any) => n.id)).toEqual([ids[0]]);
    const keepers = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/feed?lens=keepers` });
    expect(keepers.json().items.map((n: any) => n.id)).toEqual([ids[1]]);
    const ungrouped = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/feed?ungrouped=1` });
    expect(ungrouped.json().items.map((n: any) => n.id)).toEqual([ids[2], ids[1]]);
    const withCup = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/feed?token=p-cup` });
    expect(withCup.json().items.map((n: any) => n.id)).toEqual([ids[1]]);
    const lineage = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/feed?lineage=${ids[0]}` });
    expect(lineage.json().items.map((n: any) => n.id)).toEqual([ids[0]]);
  });
});

describe('the frame, the tree and the usage', () => {
  it('the workspace carries the frame and the newest shots, never every node', async () => {
    const { brand, root, ids } = await brandWithShots(3);
    const ws = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    expect(ws.json().root).toBe(root.id);
    expect('nodes' in ws.json()).toBe(false);
    expect(ws.json().recent.map((n: any) => n.id)).toEqual([ids[2], ids[1], ids[0]]);
  });

  it("answers a shot's lineage from the parent index", async () => {
    const { project, ids } = await brandWithShots(2);
    const [edit] = core.store.addNodes({
      projectId: project.id,
      parentId: ids[0],
      kind: 'edit',
      prompt: 'tighter',
      engineId: 'demo',
      count: 1,
    });
    const res = await app.inject({ method: 'GET', url: `/api/nodes/${edit.id}/lineage` });
    expect(res.json().ancestors.map((n: any) => n.id)).toEqual([ids[0]]);
    expect(res.json().siblings.map((n: any) => n.id)).toEqual([edit.id]);
    const parent = await app.inject({ method: 'GET', url: `/api/nodes/${ids[0]}/lineage` });
    expect(parent.json().children.map((n: any) => n.id)).toEqual([edit.id]);
    expect(parent.json().siblings.map((n: any) => n.id)).toEqual([ids[0], ids[1]]);
    // the whole history of the root rides on every answer in the tree
    expect(parent.json().history.map((n: any) => n.id)).toEqual([ids[0], edit.id]);
    expect(res.json().history.map((n: any) => n.id)).toEqual([ids[0], edit.id]);
    expect((await app.inject({ method: 'GET', url: '/api/nodes/nope/lineage' })).statusCode).toBe(404);
  });

  it('counts usage by day and keeps the whole record on the node route', async () => {
    const { brand, ids } = await brandWithShots(2);
    const usage = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/usage` });
    expect(usage.json().days).toHaveLength(1);
    expect(usage.json().days[0].generations).toBe(2);
    const full = await app.inject({ method: 'GET', url: `/api/nodes/${ids[0]}` });
    expect(full.json().prompt).toBe('shot number zero on linen');
    expect(full.json().promptHead).toBe('shot number zero on linen');
  });

  it('keep and archive answer with the list shape', async () => {
    const { ids } = await brandWithShots(1);
    const kept = await app.inject({ method: 'POST', url: `/api/nodes/${ids[0]}/keep`, payload: { kept: true } });
    expect(kept.json().kept).toBe(true);
    expect('prompt' in kept.json()).toBe(false);
    const archived = await app.inject({
      method: 'POST',
      url: `/api/nodes/${ids[0]}/archive`,
      payload: { archived: true },
    });
    expect(archived.json()).toMatchObject({ archived: true, kept: false });
    expect('overlays' in archived.json()).toBe(false);
  });
});

describe('the danger zone', () => {
  it('deleting every shot takes its derivatives with it', async () => {
    const { brand, ids } = await brandWithShots(2);
    const hash = core.store.getNode(ids[0])!.images[0];
    // make a derivative the way a tile does
    expect((await app.inject({ method: 'GET', url: `/api/images/${hash}/thumb?w=640` })).statusCode).toBe(200);
    const thumbs = join(home, 'thumbs');
    expect(readdirSync(thumbs).length).toBeGreaterThan(0);

    const wiped = await app.inject({ method: 'DELETE', url: '/api/data?scope=shots' });
    expect(wiped.json().ok).toBe(true);
    // nothing knows those hashes any more, so nothing else could ever remove them
    expect(readdirSync(thumbs)).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/feed` })).json().counts.total).toBe(0);
  });
});

describe('images and their derivatives', () => {
  it('streams the original with its hash as the ETag', async () => {
    const { ids } = await brandWithShots(1);
    const hash = core.store.getNode(ids[0])!.images[0];
    const res = await app.inject({ method: 'GET', url: `/api/images/${hash}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers.etag).toBe(`"${hash}"`);
    expect(res.headers['cache-control']).toContain('immutable');
    expect(Number(res.headers['content-length'])).toBe(res.rawPayload.length);
    const again = await app.inject({
      method: 'GET',
      url: `/api/images/${hash}`,
      headers: { 'if-none-match': `"${hash}"` },
    });
    expect(again.statusCode).toBe(304);
    expect((await app.inject({ method: 'GET', url: `/api/images/${'0'.repeat(32)}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/images/not-a-hash' })).statusCode).toBe(404);
  });

  it('serves a tile-sized WebP derivative, smaller than the original, immutable, made once', async () => {
    const { ids } = await brandWithShots(1);
    const hash = core.store.getNode(ids[0])!.images[0];
    const original = await app.inject({ method: 'GET', url: `/api/images/${hash}` });
    const thumb = await app.inject({ method: 'GET', url: `/api/images/${hash}/thumb?w=160` });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect(thumb.headers.etag).toBe(`"${hash}-w160"`);
    expect(thumb.headers['cache-control']).toContain('immutable');
    expect(thumb.rawPayload.length).toBeLessThan(original.rawPayload.length);
    const meta = await sharp(thumb.rawPayload).metadata();
    // a 64 px original is never enlarged
    expect(meta.width).toBe(64);
    expect(existsSync(join(home, 'thumbs', `${hash}-w160.webp`))).toBe(true);
    const cached = await app.inject({
      method: 'GET',
      url: `/api/images/${hash}/thumb?w=160`,
      headers: { 'if-none-match': `"${hash}-w160"` },
    });
    expect(cached.statusCode).toBe(304);
    expect((await app.inject({ method: 'GET', url: `/api/images/${hash}/thumb?w=300` })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/images/${'0'.repeat(32)}/thumb?w=640` })).statusCode).toBe(
      404,
    );
  });

  it('falls back to the original when a derivative cannot be made', async () => {
    const hash = core.images.save(Buffer.from('not a picture at all'));
    const res = await app.inject({ method: 'GET', url: `/api/images/${hash}/thumb?w=640` });
    expect(res.statusCode).toBe(307);
    expect(res.headers.location).toBe(`/api/images/${hash}`);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('counts the library without blocking, and the danger zone takes the derivatives too', async () => {
    const { ids } = await brandWithShots(2);
    const hash = core.store.getNode(ids[0])!.images[0];
    await app.inject({ method: 'GET', url: `/api/images/${hash}/thumb?w=160` });
    const homeRes = await app.inject({ method: 'GET', url: '/api/home' });
    expect(homeRes.json().images).toBe(2);
    expect(homeRes.json().bytes).toBeGreaterThan(0);
    expect(existsSync(join(home, 'thumbs'))).toBe(true);
  });
});
