import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';
import { waitDone as waitDoneOn } from './helpers.js';
import type { FastifyInstance } from 'fastify';

let home: string;
let core: Core;
let app: FastifyInstance;

function registryWith(...adapters: EngineAdapter[]) {
  const byId = new Map(adapters.map((a) => [a.capabilities().id, a]));
  return { all: () => adapters, get: (id: string) => byId.get(id) ?? null };
}

const waitDone = (nodeId: string) => waitDoneOn(app, nodeId);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-srv-'));
  core = createCore(home);
  app = buildServer({ core, engines: registryWith(createDemoEngine((b) => core.images.save(b))) });
});
afterEach(async () => {
  await app.close();
  core.close();
  rmSync(home, { recursive: true, force: true });
});

const mkBrand = async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/brands',
    payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' }, palette: { primary: { hex: '#1F3D2B' } } } },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
};
const mkProject = async (brandId: string) => {
  const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { brandId, name: 'camp' } });
  return res.json();
};

describe('brands API', () => {
  it('rejects invalid brand json', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/brands',
      payload: { brand: { specVersion: '0.1', meta: {} } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().details.length).toBeGreaterThan(0);
  });
  it('creates from URL via injected fetch, saving logo asset', async () => {
    const html = `<html><head><title>Zen Tea</title><meta name="theme-color" content="#2A6F4E"><link rel="icon" href="/i.png"></head></html>`;
    const fetchImpl = (async (input: any) =>
      String(input).endsWith('/i.png')
        ? new Response(Buffer.from([1, 2, 3]))
        : new Response(html)) as unknown as typeof fetch;
    const srv = buildServer({ core, engines: registryWith(), fetchImpl });
    const res = await srv.inject({
      method: 'POST',
      url: '/api/brands/from-url',
      payload: { url: 'https://zen.example' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.json.meta.name).toBe('Zen Tea');
    expect(body.json.logos[0].file).toMatch(/^asset:[a-f0-9]{32}$/);
    await srv.close();
  });
  it('rejects non-http url', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/brands/from-url',
      payload: { url: 'file:///etc/passwd' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('generation flow', () => {
  it('generate -> done with images; edit child; keep; tree', async () => {
    const brand = await mkBrand();
    const { project, root } = await mkProject(brand.id);

    const gen = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        parentId: root.id,
        kind: 'generation',
        prompt: 'hero',
        engineId: 'demo',
        count: 2,
        width: 256,
        height: 256,
      },
    });
    expect(gen.statusCode).toBe(202);
    const genNode = await waitDone(gen.json().id);
    expect(genNode.status).toBe('done');
    expect(genNode.images).toHaveLength(2);

    const img = await app.inject({ method: 'GET', url: `/api/images/${genNode.images[0]}` });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');

    const edit = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { projectId: project.id, parentId: genNode.id, kind: 'edit', prompt: 'warmer', engineId: 'demo' },
    });
    expect(edit.statusCode).toBe(202);
    const editNode = await waitDone(edit.json().id);
    expect(editNode.status).toBe('done');
    expect(editNode.parentId).toBe(genNode.id);

    const kept = await app.inject({ method: 'POST', url: `/api/nodes/${editNode.id}/keep`, payload: { kept: true } });
    expect(kept.json().kept).toBe(true);

    const tree = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/tree` });
    expect(tree.json().nodes).toHaveLength(3);
  });

  it('edit without parent image -> 400; unknown engine -> 400', async () => {
    const brand = await mkBrand();
    const { project, root } = await mkProject(brand.id);
    const noImg = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { projectId: project.id, parentId: root.id, kind: 'edit', prompt: 'x', engineId: 'demo' },
    });
    expect(noImg.statusCode).toBe(400);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { projectId: project.id, kind: 'generation', prompt: 'x', engineId: 'nope' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('spend cap blocks with 402', async () => {
    const paid: EngineAdapter = {
      capabilities: () => ({
        id: 'paid',
        displayName: 'Paid',
        localOnly: false,
        supportsEdit: false,
        supportsMask: false,
        maxReferenceImages: 0,
      }),
      isAvailable: async () => ({ ok: true }),
      costEstimate: async () => 0.5,
      generate: async () => ({ images: [], costUsd: 0.5 }),
      edit: async () => ({ images: [], costUsd: 0.5 }),
    };
    const srv = buildServer({ core, engines: registryWith(paid) });
    core.ledger.setCap('paid', 0.3);
    const brand = await mkBrand();
    const proj = await srv.inject({ method: 'POST', url: '/api/projects', payload: { brandId: brand.id, name: 'p' } });
    const res = await srv.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { projectId: proj.json().project.id, kind: 'generation', prompt: 'x', engineId: 'paid' },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().error).toMatch(/Spend cap/);
    await srv.close();
  });
});

describe('diff + export + settings', () => {
  it('diff scores identical images 0 and different images > 0, saves heatmap', async () => {
    const brand = await mkBrand();
    const { project, root } = await mkProject(brand.id);
    const gen = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        parentId: root.id,
        kind: 'generation',
        prompt: 'a vs b',
        engineId: 'demo',
        count: 2,
        width: 128,
        height: 128,
      },
    });
    const node = await waitDone(gen.json().id);
    const same = await app.inject({
      method: 'POST',
      url: '/api/diff',
      payload: { imageA: node.images[0], imageB: node.images[0] },
    });
    expect(same.json().score).toBe(0);
    const diff = await app.inject({
      method: 'POST',
      url: '/api/diff',
      payload: { imageA: node.images[0], imageB: node.images[1] },
    });
    expect(diff.json().score).toBeGreaterThan(0);
    expect(core.images.has(diff.json().heatmapHash)).toBe(true);
  });

  it('export returns a zip with selected presets', async () => {
    const brand = await mkBrand();
    const { project, root } = await mkProject(brand.id);
    const gen = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        parentId: root.id,
        kind: 'generation',
        prompt: 'x',
        engineId: 'demo',
        width: 128,
        height: 128,
      },
    });
    const node = await waitDone(gen.json().id);
    const res = await app.inject({
      method: 'POST',
      url: '/api/export',
      payload: { imageHash: node.images[0], presets: ['original', 'banner'], baseName: 'acme hero!' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });

  it('review fixes: null parent anchors to root; in-flight reservations enforce cap; non-PNG normalized', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slow: EngineAdapter = {
      capabilities: () => ({
        id: 'slow',
        displayName: 'Slow',
        localOnly: false,
        supportsEdit: false,
        supportsMask: false,
        maxReferenceImages: 0,
      }),
      isAvailable: async () => ({ ok: true }),
      costEstimate: async () => 0.4,
      generate: async () => {
        await gate;
        const jpeg = await (await import('sharp'))
          .default({ create: { width: 8, height: 8, channels: 3, background: '#aa3311' } })
          .jpeg()
          .toBuffer();
        return { images: [core.images.save(jpeg)], costUsd: 0.4 };
      },
      edit: async () => ({ images: [], costUsd: 0 }),
    };
    const srv = buildServer({ core, engines: registryWith(slow) });
    core.ledger.setCap('slow', 0.5);
    const brand = await mkBrand();
    const proj = (
      await srv.inject({ method: 'POST', url: '/api/projects', payload: { brandId: brand.id, name: 'p' } })
    ).json();

    // no parentId → anchored to root, not null
    const first = await srv.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { projectId: proj.project.id, kind: 'generation', prompt: 'a', engineId: 'slow' },
    });
    expect(first.statusCode).toBe(202);
    expect(first.json().parentId).toBe(proj.root.id);

    // second request while first still in flight → reservation pushes past cap → 402
    const second = await srv.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { projectId: proj.project.id, kind: 'generation', prompt: 'b', engineId: 'slow' },
    });
    expect(second.statusCode).toBe(402);

    release();
    const app0 = app;
    app = srv; // waitDone helper uses `app`
    const done = await waitDone(first.json().id);
    app = app0;
    // engine emitted JPEG; server must have normalized the stored image to PNG
    const stored = core.images.read(done.images[0]);
    expect(stored.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    // after completion the reservation is released → next request passes again... but spend (0.4)+est(0.4)>cap(0.5) → still 402 via recorded cost
    const third = await srv.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { projectId: proj.project.id, kind: 'generation', prompt: 'c', engineId: 'slow' },
    });
    expect(third.statusCode).toBe(402);
    await srv.close();
  });

  it('overlays: round-trip, validation, 404', async () => {
    const brand = await mkBrand();
    const { project, root } = await mkProject(brand.id);
    const gen = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        parentId: root.id,
        kind: 'generation',
        prompt: 'x',
        engineId: 'demo',
        width: 64,
        height: 64,
      },
    });
    const node = await waitDone(gen.json().id);

    const layers = [
      {
        id: 'l1',
        text: 'Built to move.',
        x: 10,
        y: 8,
        width: 60,
        fontId: 'inter-tight',
        size: 72,
        weight: 700,
        color: '#ffffff',
        align: 'left',
        lineHeight: 1.1,
        opacity: 1,
        shadow: null,
      },
    ];
    const put = await app.inject({
      method: 'PUT',
      url: `/api/nodes/${node.id}/overlays`,
      payload: { overlays: { '0': layers } },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().overlays['0'][0].text).toBe('Built to move.');

    const refetched = await app.inject({ method: 'GET', url: `/api/nodes/${node.id}` });
    expect(refetched.json().overlays['0']).toHaveLength(1);

    expect(
      (await app.inject({ method: 'PUT', url: `/api/nodes/${node.id}/overlays`, payload: { overlays: [1] } }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/nodes/${node.id}/overlays`,
          payload: { overlays: { '0': 'nope' } },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/nodes/00000000-0000-0000-0000-000000000000/overlays',
          payload: { overlays: {} },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('images: upload normalizes to png and serves back', async () => {
    // 1x1 red gif, deliberately not a png, so the normalize step is exercised
    const gif = Buffer.from('R0lGODlhAQABAIAAAP8AAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
    const boundary = '----btupload';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="ref.gif"\r\nContent-Type: image/gif\r\n\r\n`,
      ),
      gif,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await app.inject({
      method: 'POST',
      url: '/api/images',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(up.statusCode).toBe(200);
    const { hash } = up.json();
    expect(hash).toMatch(/^[0-9a-f]{32,}$/);

    const got = await app.inject({ method: 'GET', url: `/api/images/${hash}` });
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.rawPayload.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    // multipart with no file part at all: our own guard, not the plugin's
    const fieldsOnly = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nhi\r\n--${boundary}--\r\n`,
    );
    const bad = await app.inject({
      method: 'POST',
      url: '/api/images',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: fieldsOnly,
    });
    expect(bad.statusCode).toBe(400);
  });

  it('activity: every project in the brand, named, root excluded', async () => {
    const brand = await mkBrand();
    const other = await mkBrand();
    const a = await mkProject(brand.id);
    const b = await mkProject(brand.id);
    const away = await mkProject(other.id);

    const gen = async (p: any, prompt: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/nodes',
        payload: {
          projectId: p.project.id,
          parentId: p.root.id,
          kind: 'generation',
          prompt,
          engineId: 'demo',
          width: 64,
          height: 64,
        },
      });
      return waitDone(res.json().id);
    };
    const inA = await gen(a, 'first');
    const inB = await gen(b, 'second');
    const elsewhere = await gen(away, 'not mine');

    const res = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/activity` });
    expect(res.statusCode).toBe(200);
    const ids = res.json().nodes.map((n: any) => n.id);
    expect(ids).toContain(inA.id);
    expect(ids).toContain(inB.id);
    // another brand's work, and the project roots, are not activity
    expect(ids).not.toContain(elsewhere.id);
    expect(res.json().nodes.every((n: any) => n.kind !== 'root')).toBe(true);
    // every row carries its sets without a second request, and none is fine
    expect(res.json().nodes.every((n: any) => Array.isArray(n.setNames))).toBe(true);
    expect(res.json().jobs).toEqual([]);

    const missing = await app.inject({ method: 'GET', url: '/api/brands/nope/activity' });
    expect(missing.statusCode).toBe(404);
  });

  it('workspace: one request for the shots, the sets and who is in what', async () => {
    const brand = await mkBrand();
    const ws = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    expect(ws.statusCode).toBe(200);
    // the brand had no project at all: asking is what makes the one
    expect(ws.json().project.brandId).toBe(brand.id);
    expect(ws.json().sets).toEqual([]);
    expect(ws.json().membership).toEqual({});

    const again = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    expect(again.json().project.id).toBe(ws.json().project.id);

    const missing = await app.inject({ method: 'GET', url: '/api/brands/nope/workspace' });
    expect(missing.statusCode).toBe(404);
  });

  it('sets: create, rename, add a shot, and delete without taking the shot with it', async () => {
    const brand = await mkBrand();
    const ws = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    const projectId = ws.json().project.id;
    const shot = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { projectId, kind: 'generation', prompt: 'a shot', engineId: 'demo', width: 64, height: 64 },
    });
    const nodeId = shot.json().id;

    const made = await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/sets`, payload: { name: 'Spring' } });
    expect(made.statusCode).toBe(200);
    expect(made.json().slug).toBe('spring');
    const setId = made.json().id;

    // a set with no name is not a set
    const unnamed = await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/sets`, payload: { name: '  ' } });
    expect(unnamed.statusCode).toBe(400);

    const added = await app.inject({ method: 'POST', url: `/api/sets/${setId}/nodes`, payload: { nodeIds: [nodeId] } });
    expect(added.json()).toEqual({ ok: true, added: 1 });
    const withShot = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    expect(withShot.json().membership[setId]).toEqual([nodeId]);

    const renamed = await app.inject({ method: 'PATCH', url: `/api/sets/${setId}`, payload: { name: 'Autumn' } });
    expect(renamed.json().name).toBe('Autumn');
    expect(renamed.json().slug).toBe('autumn');

    // a shot id nobody knows is refused rather than quietly stored
    const bogus = await app.inject({ method: 'POST', url: `/api/sets/${setId}/nodes`, payload: { nodeIds: ['nope'] } });
    expect(bogus.statusCode).toBe(400);

    await app.inject({ method: 'DELETE', url: `/api/sets/${setId}/nodes/${nodeId}` });
    const emptied = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    expect(emptied.json().membership[setId]).toBeUndefined();
    // removing from a set is not deleting: the shot is still on the feed
    expect(emptied.json().nodes.some((n: any) => n.id === nodeId)).toBe(true);

    expect((await app.inject({ method: 'DELETE', url: `/api/sets/${setId}` })).json()).toEqual({ ok: true });
    const gone = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    expect(gone.json().sets).toEqual([]);
    expect(gone.json().nodes.some((n: any) => n.id === nodeId)).toBe(true);

    expect((await app.inject({ method: 'PATCH', url: '/api/sets/nope', payload: { name: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/sets/nope' })).statusCode).toBe(404);
  });

  it('wiping shots takes the sets with them, so no name is left pointing at nothing', async () => {
    const brand = await mkBrand();
    await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/sets`, payload: { name: 'Spring' } });

    const wiped = await app.inject({ method: 'DELETE', url: '/api/data?scope=shots' });
    expect(wiped.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/sets` });
    expect(after.json()).toEqual([]);
  });

  it('settings: secrets write-only', async () => {
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { openrouter_api_key: 'sk-secret' } });
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.json().openrouter_api_key).toBe(true);
    expect(JSON.stringify(res.json())).not.toContain('sk-secret');
  });
});
