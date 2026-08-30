/**
 * Identity conditioning: the face has to be IN the payload.
 *
 * Measured 2026-08-30 against the reported failure — four outputs of one
 * Generate 4 coming back with four different jaws. Every presenter reference
 * frame is full-length head-to-toe, so the face arrives at roughly 105px brow
 * to chin while a tight portrait renders it at around 450px. The payload fixed
 * the person's type and colouring and left the bone structure to the prior.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter, type GenerateRequest } from '@scenri/core';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { brandJsonWithIdentityCrops, identityCrop } from '../src/customAssets.js';

let home: string;
let core: Core;

/** A standing figure on a seamless backdrop: what a studio frame really is. */
async function studioFrame(bodyTint = { r: 210, g: 205, b: 200 }): Promise<Buffer> {
  const W = 1024;
  const H = 1280;
  // head near the top, body below, both well inside a white sweep
  const head = await sharp({ create: { width: 120, height: 150, channels: 3, background: { r: 190, g: 150, b: 130 } } })
    .png()
    .toBuffer();
  const body = await sharp({ create: { width: 220, height: 940, channels: 3, background: bodyTint } })
    .png()
    .toBuffer();
  return sharp({ create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([
      { input: head, left: 452, top: 60 },
      { input: body, left: 402, top: 210 },
    ])
    .png()
    .toBuffer();
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'sc-identity-'));
  core = createCore(home);
});
afterEach(() => {
  core.close();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('identityCrop', () => {
  /** What share of a picture is head, measured off the pixels themselves. */
  async function headShare(hash: string): Promise<number> {
    const { data, info } = await sharp(core.images.read(hash))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let head = 0;
    for (let i = 0; i < data.length; i += info.channels)
      if (Math.abs(data[i] - 190) < 12 && Math.abs(data[i + 1] - 150) < 12 && Math.abs(data[i + 2] - 130) < 12) head++;
    return head / (info.width * info.height);
  }

  it('puts the face in the payload at reference scale, not as a detail of a figure', async () => {
    const source = core.images.save(await studioFrame());
    const cropped = await identityCrop(core, source);
    expect(cropped).toBeTruthy();

    const after = await sharp(core.images.read(cropped as string)).metadata();
    // Portrait, like the frames it rides beside.
    expect(after.height!).toBeGreaterThan(after.width!);

    // The whole point, measured off the pixels: the head is a far larger share
    // of the crop than of the full-length frame it came from. This is the
    // number the reported failure is about — a face the conditioning barely
    // describes is a face every take re-invents.
    const before = await headShare(source);
    const now = await headShare(cropped as string);
    expect(before).toBeGreaterThan(0);
    expect(now).toBeGreaterThan(before * 3);
  });

  it('does not hand the scene a white studio sweep to copy', async () => {
    /*
     * Measured on the first render battery. At 0.32 of figure height and 4:5
     * the crop was 48% backdrop, and that backdrop walked into the finished
     * pictures: a scene sitting at a steady taupe across twelve control frames
     * came back near-white in one output of every four. The reference is the
     * leading, essential character image, so its background is never neutral
     * evidence — however clearly the role directive says otherwise.
     */
    const source = core.images.save(await studioFrame());
    const cropped = (await identityCrop(core, source)) as string;
    const { data, info } = await sharp(core.images.read(cropped))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let sweep = 0;
    for (let i = 0; i < data.length; i += info.channels)
      if (data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235) sweep++;
    const share = sweep / (info.width * info.height);
    const full = await sharp(core.images.read(source)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let fullSweep = 0;
    for (let i = 0; i < full.data.length; i += full.info.channels)
      if (full.data[i] > 235 && full.data[i + 1] > 235 && full.data[i + 2] > 235) fullSweep++;
    const fullShare = fullSweep / (full.info.width * full.info.height);
    // Strictly less backdrop than the full-length frame it replaces at the
    // head of the list, and never a majority of the picture.
    expect(share).toBeLessThan(fullShare);
    expect(share).toBeLessThan(0.5);
  });

  it('never inflates a crop into blur', async () => {
    // An upscale adds no detail. Past about 3x the only thing it adds is blur,
    // and a blurred face is a worse reference than a small sharp one.
    const source = core.images.save(await studioFrame());
    const cropped = (await identityCrop(core, source)) as string;
    const after = await sharp(core.images.read(cropped)).metadata();
    // the crop is 0.26 of a 1090px figure, so the stored height is bounded by
    // three times that rather than by the 1280 target
    expect(after.height!).toBeLessThanOrEqual(3 * Math.round(1090 * 0.26) + 2);
  });

  it('is content-addressed, so the same frame derives once', async () => {
    const source = core.images.save(await studioFrame());
    const a = await identityCrop(core, source);
    const b = await identityCrop(core, source);
    expect(a).toBe(b);
  });

  it('returns nothing rather than guessing when there is no readable figure', async () => {
    // All subject, no backdrop to trim: any box would be invented, and a wrong
    // crop is worse than none — it would attach a chest as the identity.
    const flat = core.images.save(
      await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 90, g: 90, b: 90 } } })
        .png()
        .toBuffer(),
    );
    expect(await identityCrop(core, flat)).toBeUndefined();
    expect(await identityCrop(core, undefined)).toBeUndefined();
    expect(await identityCrop(core, 'not-a-hash')).toBeUndefined();
  });
});

describe('brandJsonWithIdentityCrops', () => {
  const roster = (front: string, second: string) => ({
    characters: [
      { id: 'c1', name: 'One', shots: [{ file: `asset:${front}` }, { file: `asset:${second}` }] },
      { id: 'c2', name: 'Two', shots: [{ file: `asset:${front}` }] },
    ],
  });

  it('leads the referenced presenter with their own crop and leaves the rest alone', async () => {
    const front = core.images.save(await studioFrame());
    const second = core.images.save(await studioFrame({ r: 180, g: 178, b: 172 }));
    const json = roster(front, second);
    const out = await brandJsonWithIdentityCrops(core, json, ['c1']);

    const one = out.characters.find((c: any) => c.id === 'c1');
    expect(one.shots).toHaveLength(3);
    expect(one.shots[0].angle).toBe('identity');
    expect(one.shots[0].file).not.toBe(`asset:${front}`);
    // the original angles are still there, in order, behind it
    expect(one.shots.slice(1).map((s: any) => s.file)).toEqual([`asset:${front}`, `asset:${second}`]);

    // an unreferenced presenter is untouched
    expect(out.characters.find((c: any) => c.id === 'c2')).toEqual(json.characters[1]);
  });

  it('hands back the same object when there is nothing to do', async () => {
    const front = core.images.save(await studioFrame());
    const json = roster(front, front);
    expect(await brandJsonWithIdentityCrops(core, json, [])).toBe(json);
    expect(await brandJsonWithIdentityCrops(core, { characters: [] }, ['c1'])).toEqual({ characters: [] });
  });

  it('leaves a presenter who already leads with a portrait exactly as they were', async () => {
    /*
     * The portrait ships untouched, sweep and all. A trim that boxed it
     * tighter was built and measured over three batches each way: identity
     * held 12/12 both times and the occasional light-backdrop frame appeared
     * at the same rate trimmed or not, while the control's references were
     * 85% sweep and never leaked once. The leak is the portrait's framing
     * matching the output's, which no crop changes — so no derivation runs.
     */
    const portrait = core.images.save(await studioFrame());
    const standing = core.images.save(await studioFrame({ r: 180, g: 178, b: 172 }));
    const json = {
      characters: [
        {
          id: 'c1',
          name: 'One',
          shots: [
            { file: `asset:${portrait}`, angle: 'portrait' },
            { file: `asset:${standing}`, angle: 'front' },
          ],
        },
      ],
    };
    expect(await brandJsonWithIdentityCrops(core, json, ['c1'])).toBe(json);
  });

  it('leaves a presenter whose frame has no readable figure exactly as they were', async () => {
    const flat = core.images.save(
      await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 90, g: 90, b: 90 } } })
        .png()
        .toBuffer(),
    );
    const json = { characters: [{ id: 'c1', name: 'One', shots: [{ file: `asset:${flat}` }] }] };
    // Never break a working generation to attempt an improvement.
    expect(await brandJsonWithIdentityCrops(core, json, ['c1'])).toBe(json);
  });
});

/**
 * The whole chain, on the route a real Generate takes: the crop has to reach
 * the engine as the presenter's leading reference, or none of this is real.
 */
describe('a generation conditions on the face', () => {
  let app: FastifyInstance;
  let sent: GenerateRequest[];

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
    generate: async (req) => {
      sent.push(req);
      return { images: [core.images.save(await studioFrame())], costUsd: 0 };
    },
    edit: async () => ({ images: [], costUsd: 0 }),
  });

  beforeEach(() => {
    sent = [];
    const e = engine();
    app = buildServer({ core, engines: { all: () => [e], get: (id) => (id === 'spy' ? e : null) } });
  });
  afterEach(async () => {
    await app.close();
  });

  it('sends the crop as the presenter, ahead of the full-length frames', async () => {
    const front = core.images.save(await studioFrame());
    const second = core.images.save(await studioFrame({ r: 180, g: 178, b: 172 }));
    const brand = (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: {
          brand: {
            specVersion: '0.1',
            meta: { name: 'Acme' },
            characters: [{ id: 'c1', name: 'One', shots: [{ file: `asset:${front}` }, { file: `asset:${second}` }] }],
          },
        },
      })
    ).json();
    const project = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { brandId: brand.id, name: 'p' } })
    ).json().project;

    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        kind: 'generation',
        engineId: 'spy',
        count: 1,
        brief: {
          tokens: [
            { t: 'format', id: 'portrait', w: 816, h: 1024 },
            { t: 'character', id: 'c1' },
            { t: 'text', v: 'a portrait' },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(202);
    for (let i = 0; i < 80 && !sent.length; i++) await new Promise((r) => setTimeout(r, 25));
    expect(sent).toHaveLength(1);

    const refs = sent[0].referenceImages ?? [];
    expect(sent[0].referenceRoles).toEqual(['character', 'character', 'character']);
    // The leading reference is the derived crop, not a frame the roster holds.
    const derived = await identityCrop(core, front);
    expect(refs[0]).toBe(core.images.pathFor(derived as string));
    expect(refs[0]).not.toBe(core.images.pathFor(front));
    // The full-length angles still ride behind it, in their own order.
    expect(refs.slice(1)).toEqual([core.images.pathFor(front), core.images.pathFor(second)]);
  });

  it('previews exactly what it will send', async () => {
    /*
     * The house rule: what the composer previews and what the engine receives
     * can never drift. Wiring the crop into the generation path and not into
     * the preview would have shown the user one set of references and sent
     * another, silently. Nothing in the UI would have said so.
     */
    const front = core.images.save(await studioFrame());
    const brand = (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: {
          brand: {
            specVersion: '0.1',
            meta: { name: 'Acme' },
            characters: [{ id: 'c1', name: 'One', shots: [{ file: `asset:${front}` }] }],
          },
        },
      })
    ).json();
    const project = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { brandId: brand.id, name: 'p' } })
    ).json().project;
    const brief = {
      tokens: [
        { t: 'format', id: 'portrait', w: 816, h: 1024 },
        { t: 'character', id: 'c1' },
        { t: 'text', v: 'a portrait' },
      ],
    };

    const preview = (
      await app.inject({
        method: 'POST',
        url: '/api/brief/preview',
        payload: { brandId: brand.id, engineId: 'spy', brief },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { projectId: project.id, kind: 'generation', engineId: 'spy', count: 1, brief },
    });
    for (let i = 0; i < 80 && !sent.length; i++) await new Promise((r) => setTimeout(r, 25));

    expect(preview.referenceCount).toBe(sent[0].referenceImages?.length);
    expect(preview.attachments.map((a: { hash: string }) => core.images.pathFor(a.hash))).toEqual(
      sent[0].referenceImages,
    );
    expect(preview.prompt).toBe(sent[0].prompt);
  });
});
