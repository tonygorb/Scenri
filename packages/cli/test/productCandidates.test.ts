import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter, type GenerateRequest } from '@scenri/core';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { resetProductCandidates } from '../src/productCandidates.js';
import { createThumbStore } from '../src/thumbs.js';

/**
 * A drawn view of a product is made one at a time, held for a decision, and
 * never reaches a product until Save names it. What these pin: the references
 * a candidate is drawn from (photographs first, then kept views, capped by the
 * engine), the decision states, and that a rejected or abandoned candidate's
 * bytes actually leave the disk while anything referenced elsewhere survives.
 */
describe('product candidates', () => {
  let home: string;
  let core: Core;
  let app: FastifyInstance;
  let generated: GenerateRequest[];
  /** Resolves the next generate call when the test says so; null means answer at once. */
  let hold: { release: () => void } | null;
  /** One-shot bytes the spy engine answers with, then clears. */
  let nextBytes: Buffer | null;

  const png = (tint: string, w = 64, h = 80) =>
    sharp({ create: { width: w, height: h, channels: 3, background: tint } })
      .png()
      .toBuffer();

  /** A frame with black bars down both sides, which trimEdgeBars will cut into a second blob. */
  const barred = async () => {
    const inner = await sharp({ create: { width: 40, height: 80, channels: 3, background: '#a06040' } })
      .png()
      .toBuffer();
    return sharp({ create: { width: 64, height: 80, channels: 3, background: '#000000' } })
      .composite([{ input: inner, left: 12, top: 0 }])
      .png()
      .toBuffer();
  };

  const engine = (): EngineAdapter => ({
    capabilities: () => ({
      id: 'spy',
      displayName: 'Spy',
      localOnly: false,
      supportsEdit: true,
      supportsMask: false,
      maxReferenceImages: 6,
    }),
    isAvailable: async () => ({ ok: true }),
    costEstimate: async () => 0,
    generate: async (req, signal) => {
      generated.push(req);
      if (hold) {
        await new Promise<void>((resolve, reject) => {
          hold = { release: resolve };
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      const bytes = nextBytes ?? (await png(`#${(0x20 + generated.length * 0x11).toString(16).padStart(2, '0')}3040`));
      nextBytes = null;
      return { images: [core.images.save(bytes)], costUsd: 0 };
    },
    edit: async () => ({ images: [], costUsd: 0 }),
  });

  beforeEach(() => {
    resetProductCandidates();
    generated = [];
    hold = null;
    nextBytes = null;
    home = mkdtempSync(join(tmpdir(), 'sc-cand-'));
    core = createCore(home);
    const e = engine();
    app = buildServer({ core, engines: { all: () => [e], get: (id) => (id === 'spy' ? e : null) } });
  });
  afterEach(async () => {
    await app.drain();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const newBrand = async () =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' } } },
      })
    ).json();

  const photos = async (n: number) =>
    Promise.all(
      Array.from({ length: n }, async (_, i) => core.images.save(await png(`#${(0x30 + i * 0x10).toString(16)}5060`))),
    );

  const start = (brandId: string, body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/brands/${brandId}/product-studio/candidates`, payload: body });
  const get = async (brandId: string, jobId: string) =>
    (await app.inject({ method: 'GET', url: `/api/brands/${brandId}/product-studio/candidates/${jobId}` })).json();
  const act = (brandId: string, jobId: string, verb: string) =>
    app.inject({ method: 'POST', url: `/api/brands/${brandId}/product-studio/candidates/${jobId}/${verb}` });

  const settled = async (brandId: string, jobId: string) => {
    for (let i = 0; i < 200; i++) {
      const c = await get(brandId, jobId);
      if (c.stage !== 'queued' && c.stage !== 'drawing') return c;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('candidate never settled');
  };

  it('draws one view from the photographs first, then the kept views, capped by the engine', async () => {
    const brand = await newBrand();
    const ph = await photos(5);
    const kept = await photos(2);
    const res = await start(brand.id, {
      draftId: 'd1',
      angle: 'three-quarter',
      photoHashes: ph,
      keptHashes: kept,
      sheet: { promptName: 'Amber Glass Dropper Bottle', materials: 'amber glass', primaryColors: 'deep amber' },
    });
    expect(res.statusCode).toBe(202);
    const { jobId } = res.json();

    const c = await settled(brand.id, jobId);
    expect(c.stage).toBe('ready');
    expect(c.angle).toBe('three-quarter');
    expect(core.images.has(c.hash)).toBe(true);
    expect(c).not.toHaveProperty('bornHere');

    expect(generated).toHaveLength(1);
    const refs = generated[0].referenceImages ?? [];
    // six seats: all five photographs, then the first kept view
    expect(refs).toEqual([...ph, kept[0]].map((h) => core.images.pathFor(h)));
    expect(generated[0].referenceRoles).toEqual(refs.map(() => 'product'));
    const prompt = generated[0].prompt;
    expect(prompt).toContain('Amber Glass Dropper Bottle');
    expect(prompt).toMatch(/three-quarter/i);
    expect(prompt).toMatch(/seamless white/i);
    expect(prompt).toMatch(/no props, no hands, no person/i);
    expect(prompt).toMatch(/do not invent detail on a face the photographs do not show/i);
    expect(prompt).not.toMatch(/scene|campaign|dramatic/i);
  });

  it('keep holds the view; reject removes its bytes and its derivatives', async () => {
    const brand = await newBrand();
    const ph = await photos(1);
    const thumbs = createThumbStore(core);

    nextBytes = await barred();
    const { jobId } = (await start(brand.id, { draftId: 'd1', angle: 'side', photoHashes: ph })).json();
    const c = await settled(brand.id, jobId);
    expect(c.stage).toBe('ready');
    // the bars were cut: the offered hash is a second blob beside the raw one
    const raw = generated.length ? core.images.pathFor(c.hash) : null;
    expect(raw && existsSync(raw)).toBe(true);
    const derivative = await thumbs.ensure(c.hash, 160);
    expect(derivative && existsSync(derivative)).toBe(true);

    expect((await act(brand.id, jobId, 'keep')).statusCode).toBe(200);
    expect((await get(brand.id, jobId)).stage).toBe('kept');
    expect(core.images.has(c.hash)).toBe(true);

    expect((await act(brand.id, jobId, 'reject')).statusCode).toBe(200);
    expect((await get(brand.id, jobId)).stage).toBe('rejected');
    expect(core.images.has(c.hash)).toBe(false);
    expect(existsSync(derivative!)).toBe(false);
    // the photograph it was drawn from is untouched
    expect(core.images.has(ph[0])).toBe(true);
    // every blob the draw minted is gone: nothing but the photograph remains
    const left = (await import('node:fs')).readdirSync(join(home, 'images'));
    expect(left).toEqual([`${ph[0]}.png`]);
  });

  it('never removes bytes that something else already references', async () => {
    const brand = await newBrand();
    const ph = await photos(1);
    // the engine answers with the photograph's own bytes: the same hash, referenced by the brand
    nextBytes = await png('#305060');
    const same = core.images.save(nextBytes);
    expect(same).toBe(ph[0]);
    await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/products`,
      payload: { name: 'Blend', imageHashes: [ph[0]] },
    });
    const { jobId } = (await start(brand.id, { draftId: 'd1', angle: 'front', photoHashes: ph })).json();
    const c = await settled(brand.id, jobId);
    expect(c.hash).toBe(ph[0]);
    await act(brand.id, jobId, 'reject');
    expect(core.images.has(ph[0])).toBe(true);
  });

  it('cancel stops a draw mid-flight and leaves nothing behind', async () => {
    const brand = await newBrand();
    const ph = await photos(1);
    hold = { release: () => {} };
    const { jobId } = (await start(brand.id, { draftId: 'd1', angle: 'front', photoHashes: ph })).json();
    for (let i = 0; i < 50 && (await get(brand.id, jobId)).stage !== 'drawing'; i++)
      await new Promise((r) => setTimeout(r, 5));
    expect((await get(brand.id, jobId)).stage).toBe('drawing');

    expect((await act(brand.id, jobId, 'cancel')).statusCode).toBe(200);
    const c = await settled(brand.id, jobId);
    expect(c.stage).toBe('cancelled');
    expect(c.hash).toBeNull();
    expect((await import('node:fs')).readdirSync(join(home, 'images'))).toEqual([`${ph[0]}.png`]);
  });

  it('refuses a face the photographs cannot vouch for, an unknown photograph, and a second draw at once', async () => {
    const brand = await newBrand();
    const ph = await photos(1);
    expect((await start(brand.id, { draftId: 'd1', angle: 'back', photoHashes: ph })).statusCode).toBe(400);
    expect((await start(brand.id, { draftId: 'd1', angle: 'label', photoHashes: ph })).statusCode).toBe(400);
    expect((await start(brand.id, { draftId: 'd1', angle: 'front', photoHashes: ['f'.repeat(32)] })).statusCode).toBe(
      400,
    );
    expect((await start(brand.id, { draftId: 'd1', angle: 'front', photoHashes: [] })).statusCode).toBe(400);

    hold = { release: () => {} };
    const first = await start(brand.id, { draftId: 'd1', angle: 'front', photoHashes: ph });
    expect(first.statusCode).toBe(202);
    expect((await start(brand.id, { draftId: 'd1', angle: 'side', photoHashes: ph })).statusCode).toBe(409);
    await act(brand.id, first.json().jobId, 'cancel');
    await settled(brand.id, first.json().jobId);
  });

  it('abandoning a draft removes every view that was not saved, and keeps what a product already holds', async () => {
    const brand = await newBrand();
    const ph = await photos(1);
    const a = (await start(brand.id, { draftId: 'd1', angle: 'three-quarter', photoHashes: ph })).json().jobId;
    const ca = await settled(brand.id, a);
    await act(brand.id, a, 'keep');
    const b = (await start(brand.id, { draftId: 'd1', angle: 'side', photoHashes: ph, keptHashes: [ca.hash] })).json()
      .jobId;
    const cb = await settled(brand.id, b);
    // the kept view is saved into a product; the ready one is not
    const saved = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/products`,
      payload: {
        name: 'Blend',
        draftId: 'd1',
        shots: [
          { hash: ph[0], angle: 'front' },
          { hash: ca.hash, angle: 'three-quarter', source: 'derived' },
        ],
      },
    });
    expect(saved.statusCode).toBe(200);

    const res = await app.inject({ method: 'DELETE', url: `/api/brands/${brand.id}/product-studio/drafts/d1` });
    expect(res.statusCode).toBe(200);
    expect(core.images.has(ca.hash)).toBe(true);
    expect(core.images.has(cb.hash)).toBe(false);
    expect(
      (await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/product-studio/candidates/${b}` })).statusCode,
    ).toBe(404);
  });
});
