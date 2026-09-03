import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUDGET_EXHAUSTED,
  createCore,
  type Core,
  type EditRequest,
  type EngineAdapter,
  type GenerateRequest,
} from '@scenri/core';
import { createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';
import { waitDone as waitDoneOn, waitRendered as waitRenderedOn } from './helpers.js';
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

/** One multipart body with a file part plus optional plain text fields. */
const filePayload = (file: Buffer, filename: string, contentType: string, fields: Record<string, string> = {}) => {
  const boundary = '----sctest';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
};
// 1x1 red gif — deliberately not a png, so normalization is exercised
const GIF_1PX = Buffer.from('R0lGODlhAQABAIAAAP8AAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
// A second, genuinely different image: the store is content-addressed, so two
// uploads of the same bytes are one asset and cannot be told apart by hash.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('brand marks', () => {
  const uploadLogo = async (brandId: string, fields: Record<string, string> = {}, file = GIF_1PX) =>
    app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/logos`,
      ...filePayload(file, 'logo.gif', 'image/gif', fields),
    });

  it('uploads a mark as a normalized asset ref and leaves the rest of the kit alone', async () => {
    const brand = await mkBrand();
    const res = await uploadLogo(brand.id);
    expect(res.statusCode).toBe(200);
    const json = res.json().json;
    expect(json.logos).toHaveLength(1);
    expect(json.logos[0].file).toMatch(/^asset:[0-9a-f]{32,}$/);
    // First mark is the primary; nothing else about the brand moved
    expect(json.logos[0]).toMatchObject({ role: 'primary', background: 'any' });
    expect(json.palette.primary.hex).toBe('#1F3D2B');
    expect(json.products).toBeUndefined();

    // The answer names the mark it just made: the client cannot compute the
    // normalized content hash itself, and the composer's add-logo tile drops
    // the chip in straight from this response. The long edge rides for the
    // tiny-source warning.
    expect(res.json().logoHash).toBe(json.logos[0].file.slice(6));
    expect(res.json().logoEdge).toBe(1);

    const served = await app.inject({ method: 'GET', url: `/api/images/${json.logos[0].file.slice(6)}` });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
  });

  it('defaults the second mark to alternate, and honours an explicit role', async () => {
    const brand = await mkBrand();
    await uploadLogo(brand.id);
    const second = await uploadLogo(brand.id, { role: 'wordmark', background: 'dark' }, PNG_1PX);
    expect(second.json().json.logos.map((l: any) => l.role)).toEqual(['primary', 'wordmark']);
    expect(second.json().json.logos[1].background).toBe('dark');
    const third = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/logos`,
      ...filePayload(Buffer.from('other-bytes-entirely'), 'x.png', 'image/png'),
    });
    expect(third.statusCode).toBe(400);
    expect(third.json().error).toMatch(/not an image/);
  });

  // "Which is THE logo" must have one answer: the nav avatar, the setup screen
  // and Settings all resolve the primary, and two entries claiming it is how
  // the wrong mark reaches a prompt.
  it('holds one primary at a time: promoting a mark demotes the incumbent', async () => {
    const brand = await mkBrand();
    await uploadLogo(brand.id); // first mark becomes the primary
    const second = await uploadLogo(brand.id, { role: 'primary' }, PNG_1PX);
    expect(second.statusCode).toBe(200);
    expect(second.json().json.logos.map((l: any) => l.role)).toEqual(['alternate', 'primary']);

    // and the same through PATCH: re-promoting the first demotes the second
    const firstHash = second.json().json.logos[0].file.slice(6);
    const promoted = await app.inject({
      method: 'PATCH',
      url: `/api/brands/${brand.id}/logos/${firstHash}`,
      payload: { role: 'primary' },
    });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json().json.logos.map((l: any) => l.role)).toEqual(['primary', 'alternate']);
  });

  it('rejects an unknown role rather than writing a document the schema will refuse', async () => {
    const brand = await mkBrand();
    const res = await uploadLogo(brand.id, { role: 'favicon' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/unknown logo role/);
    const after = await app.inject({ method: 'GET', url: '/api/brands' });
    expect(after.json()[0].json.logos ?? []).toEqual([]);
  });

  it('patches and deletes by content hash, not by position', async () => {
    const brand = await mkBrand();
    await uploadLogo(brand.id);
    const second = await uploadLogo(brand.id, { role: 'mark' }, PNG_1PX);
    const [first, mark] = second.json().json.logos;
    const firstHash = first.file.slice(6);
    const markHash = mark.file.slice(6);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/brands/${brand.id}/logos/${markHash}`,
      payload: { background: 'light', clearSpace: '1x logo height' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().json.logos[1]).toMatchObject({ background: 'light', clearSpace: '1x logo height' });
    expect(patched.json().json.logos[0].background).toBe('any');

    // Clearing prose removes the key: '' would fail schema validation and take
    // the whole document down with it.
    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/brands/${brand.id}/logos/${markHash}`,
      payload: { clearSpace: '' },
    });
    expect(cleared.json().json.logos[1].clearSpace).toBeUndefined();

    const gone = await app.inject({ method: 'DELETE', url: `/api/brands/${brand.id}/logos/${firstHash}` });
    expect(gone.statusCode).toBe(200);
    expect(gone.json().json.logos.map((l: any) => l.file.slice(6))).toEqual([markHash]);

    const missing = await app.inject({ method: 'DELETE', url: `/api/brands/${brand.id}/logos/nope` });
    expect(missing.statusCode).toBe(404);
  });

  it('refreshes from the website without undoing a single edit', async () => {
    const html = `<html><head><title>Zen Tea Company</title><meta name="description" content="Buy tea online"><meta name="theme-color" content="#2A6F4E"><link rel="icon" href="/i.gif"></head></html>`;
    const fetchImpl = (async (input: any) =>
      String(input).endsWith('/i.gif') ? new Response(GIF_1PX) : new Response(html)) as unknown as typeof fetch;
    const srv = buildServer({ core, engines: registryWith(), fetchImpl });
    const made = await srv.inject({
      method: 'POST',
      url: '/api/brands',
      payload: {
        brand: {
          specVersion: '0.1',
          meta: { name: 'Zen', tagline: 'Slow mornings' },
          palette: { primary: { hex: '#000000', name: 'Ink' } },
          rules: { never: ['competitor logos in frame'] },
        },
      },
    });
    const brand = made.json();
    const res = await srv.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/refresh-from-url`,
      payload: { url: 'https://zen.example' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.json.meta.name).toBe('Zen');
    expect(body.json.meta.tagline).toBe('Slow mornings');
    expect(body.json.meta.website).toBe('https://zen.example');
    expect(body.json.palette).toEqual({ primary: { hex: '#000000', name: 'Ink' } });
    expect(body.json.rules).toEqual({ never: ['competitor logos in frame'] });
    // The scraped colours are offered, not applied
    expect(body.suggestions.palette).toEqual([{ hex: '#2a6f4e' }]);
    expect(body.json.logos).toHaveLength(1);
    await srv.close();
  });

  it('serves the brand as a .brand zip named after its slug', async () => {
    const brand = await mkBrand();
    await uploadLogo(brand.id);
    const res = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/export` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toBe('attachment; filename="acme.brand"');
    expect(res.rawPayload.subarray(0, 2).toString()).toBe('PK');

    const missing = await app.inject({ method: 'GET', url: '/api/brands/nope/export' });
    expect(missing.statusCode).toBe(404);
  });

  it('re-uploading the same artwork retags it instead of creating a twin no hash can address', async () => {
    const brand = await mkBrand();
    await uploadLogo(brand.id);
    const again = await uploadLogo(brand.id, { role: 'monochrome', background: 'dark' });
    expect(again.json().json.logos).toHaveLength(1);
    expect(again.json().json.logos[0]).toMatchObject({ role: 'monochrome', background: 'dark' });
  });
});

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
      String(input).endsWith('/i.png') ? new Response(GIF_1PX) : new Response(html)) as unknown as typeof fetch;
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
    // A scraped mark is stored as a real PNG, not as raw favicon bytes wearing
    // a .png name — the store and /api/images both claim image/png regardless.
    const served = await srv.inject({ method: 'GET', url: `/api/images/${body.json.logos[0].file.slice(6)}` });
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await srv.close();
  });
  it('degrades to a warning when the scraped favicon is not a decodable image', async () => {
    const html = `<html><head><title>Zen Tea</title><link rel="icon" href="/i.ico"></head></html>`;
    const fetchImpl = (async (input: any) =>
      String(input).endsWith('/i.ico')
        ? new Response(Buffer.from([1, 2, 3]))
        : new Response(html)) as unknown as typeof fetch;
    const srv = buildServer({ core, engines: registryWith(), fetchImpl });
    const res = await srv.inject({
      method: 'POST',
      url: '/api/brands/from-url',
      payload: { url: 'https://zen.example' },
    });
    expect(res.statusCode).toBe(200);
    // No logo is better than a logo that renders as a broken image everywhere
    expect(res.json().json.logos).toBeUndefined();
    expect(res.json().warnings.join(' ')).toMatch(/logo/i);
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
  it('generate -> done with images; edit child; keep; tree', { timeout: 20_000 }, async () => {
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
    // one image, one node: a count-2 request answers with two siblings
    const siblings = gen.json().siblings as { id: string; batchId: string; batchIndex: number }[];
    expect(siblings).toHaveLength(2);
    expect(gen.json().id).toBe(siblings[0].id);
    expect(siblings.map((s) => s.batchIndex)).toEqual([0, 1]);
    expect(new Set(siblings.map((s) => s.batchId)).size).toBe(1);
    const genNode = await waitDone(siblings[0].id);
    const secondNode = await waitDone(siblings[1].id);
    expect(genNode.status).toBe('done');
    expect(genNode.images).toHaveLength(1);
    expect(secondNode.images).toHaveLength(1);
    expect(genNode.images[0]).not.toBe(secondNode.images[0]);

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

    // The record of what the run actually was: how long it took, and the real
    // pixels delivered — per node now, each sibling carrying its own frame.
    expect(genNode.durationMs).toBeGreaterThan(0);
    expect(secondNode.durationMs).toBeGreaterThan(0);
    // Re-read rather than reuse the waitDone snapshot: the record is written
    // after the status flips, so that snapshot can predate it. See waitRendered.
    const recorded = await waitRenderedOn(app, genNode.id);
    expect((recorded.brief as any)?.rendered?.sizes?.length).toBe(1);
    expect((recorded.brief as any).rendered.sizes[0]).toEqual([256, 256]);
    const recordedSecond = await waitRenderedOn(app, secondNode.id);
    expect((recordedSecond.brief as any).rendered.sizes).toEqual([[256, 256]]);

    // the run's money is stated once, on the first sibling
    expect(secondNode.costUsd).toBe(0);

    const tree = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/tree` });
    expect(tree.json().nodes).toHaveLength(4);
  });

  // A refinement used to compile to a bare sentence: no product reference, no
  // presenter reference, and so none of the fidelity language keyed on them.
  // The product in the picture had nothing to be held to.
  describe('a refinement keeps the shot it refines', () => {
    const briefWithProduct = () => ({
      tokens: [
        { t: 'format', id: 'square', w: 1024, h: 1024 },
        { t: 'product', id: 'p1' },
        { t: 'text', v: 'on a stone ledge' },
      ],
    });

    const seedBrand = async () => {
      const hash = core.images.save(PNG_1PX);
      const res = await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: {
          brand: {
            specVersion: '0.1',
            meta: { name: 'Acme' },
            palette: { primary: { hex: '#1F3D2B' } },
            products: [
              { id: 'p1', name: 'House Blend', shots: [{ file: `asset:${hash}`, angle: 'front', locked: true }] },
            ],
          },
        },
      });
      return { brand: res.json(), hash };
    };

    it('borrows the parent shot identity and says what must not move', { timeout: 20_000 }, async () => {
      const { brand } = await seedBrand();
      const { project } = await mkProject(brand.id);
      const gen = await app.inject({
        method: 'POST',
        url: '/api/nodes',
        payload: { projectId: project.id, kind: 'generation', engineId: 'demo', brief: briefWithProduct() },
      });
      const genNode = await waitDone(gen.json().id);

      const edit = await app.inject({
        method: 'POST',
        url: '/api/nodes',
        payload: {
          projectId: project.id,
          parentId: genNode.id,
          kind: 'edit',
          engineId: 'demo',
          sourceImage: genNode.images[0],
          brief: { tokens: [{ t: 'text', v: 'remove the cup on the left' }] },
        },
      });
      expect(edit.statusCode).toBe(202);
      const editNode = await waitDone(edit.json().id);

      // The instruction still reads as the user wrote it, and the preservation
      // clause is there to say the picture in hand is the shot.
      expect(editNode.prompt).toContain('remove the cup on the left');
      expect(editNode.prompt).toContain('This is a change to a photograph that already exists');
      expect(editNode.prompt).toContain('Change only what was asked for');
      // Identity came along, and it is named as identity rather than as a
      // reason to build a new composition - and the claim covers only what
      // rode: this thread inherited a product and no person, and the old
      // sentence claimed a person anyway.
      expect(editNode.prompt).toContain('the same product that is already in this picture');
      expect(editNode.prompt).not.toContain('and the same person');
      // And the product name is not prepended onto the instruction.
      expect(editNode.prompt.indexOf('remove the cup')).toBeLessThan(
        editNode.prompt.indexOf('This is a change to a photograph'),
      );
    });

    it('tells a whole frame change that it may move the frame, and a local one that it may not', {
      timeout: 20_000,
    }, async () => {
      const { brand } = await seedBrand();
      const { project } = await mkProject(brand.id);
      const gen = await app.inject({
        method: 'POST',
        url: '/api/nodes',
        payload: { projectId: project.id, kind: 'generation', engineId: 'demo', brief: briefWithProduct() },
      });
      const genNode = await waitDone(gen.json().id);

      const global = await app.inject({
        method: 'POST',
        url: '/api/nodes',
        payload: {
          projectId: project.id,
          parentId: genNode.id,
          kind: 'edit',
          engineId: 'demo',
          sourceImage: genNode.images[0],
          brief: { tokens: [{ t: 'text', v: 'make it nighttime' }] },
        },
      });
      const globalNode = await waitDone(global.json().id);
      expect(globalNode.prompt).toContain('Apply the instruction to the image you were given');
      expect(globalNode.prompt).not.toContain('Change only what was asked for');
    });
  });

  // Asking a finished shot for a different shape used to start a new one, so a
  // square somebody liked came back as a different picture in 16:9.
  it('grows the frame and returns the original region untouched', async () => {
    const brand = await mkBrand();
    const { project } = await mkProject(brand.id);
    const gen = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        kind: 'generation',
        engineId: 'demo',
        brief: {
          tokens: [
            { t: 'format', id: 'square', w: 256, h: 256 },
            { t: 'text', v: 'a red field' },
          ],
        },
      },
    });
    const genNode = await waitDone(gen.json().id);
    const sourceHash = genNode.images[0];
    const sharp = (await import('sharp')).default;
    const src = core.images.read(sourceHash);
    const srcMeta = await sharp(src).metadata();

    const expand = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'demo',
        sourceImage: sourceHash,
        // the same setup, asked for in a wider shape
        brief: {
          tokens: [
            { t: 'format', id: 'landscape', w: 456, h: 256 },
            { t: 'text', v: 'keep going' },
          ],
        },
      },
    });
    expect(expand.statusCode).toBe(202);
    const out = await waitDone(expand.json().id);
    expect(out.status).toBe('done');

    const grown = await sharp(core.images.read(out.images[0])).metadata();
    // it really did grow, and it grew sideways, keeping every row
    expect(grown.height).toBe(srcMeta.height);
    expect(grown.width!).toBeGreaterThan(srcMeta.width!);
    expect(grown.width! / grown.height!).toBeCloseTo(456 / 256, 1);

    // and the picture came back byte for byte — the WHOLE picture, no band
    // and no exception (see compositeExpand's guarantee). Where it sits is read
    // from the record rather than assumed: placement follows the subject now,
    // so the picture is not always centred in the frame it grew into.
    const placed = (out.brief as any).expand;
    expect(placed.method).toBe('outpaint');
    const left = placed.left as number;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + srcMeta.width!).toBeLessThanOrEqual(grown.width!);
    const region = { left, top: placed.top as number, width: srcMeta.width!, height: srcMeta.height! };
    const before = await sharp(src).removeAlpha().raw().toBuffer();
    const after = await sharp(core.images.read(out.images[0])).extract(region).removeAlpha().raw().toBuffer();
    expect(after).toEqual(before);
  });

  /*
   * The route with no mask draws twice and the two draws are shown different
   * things: the blurred bed, whose answer the original can be composited back
   * over, and the padded frame, whose answer ships whole. Which one survives is
   * decided per shot by whether the composite's join can be seen.
   */
  const twoDrawEngine = (marginTone: (bed: boolean) => number) => {
    const seen: string[] = [];
    let inFlight = 0;
    let overlapped = false;
    const sharpLib = () => import('sharp').then((m) => m.default);
    const field = async (v: number, w: number, h: number) =>
      (await sharpLib())({
        create: {
          width: w,
          height: h,
          channels: 3,
          background: { r: v, g: v, b: v },
          noise: { type: 'gaussian', mean: v, sigma: 12 },
        },
      })
        .png()
        .toBuffer();
    const engine: EngineAdapter = {
      capabilities: () => ({
        id: 'moody',
        displayName: 'Moody',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        maxReferenceImages: 0,
      }),
      isAvailable: async () => ({ ok: true }),
      costEstimate: async () => 0,
      generate: async () => ({ images: [core.images.save(await field(120, 256, 256))], costUsd: 0 }),
      edit: async (req) => {
        // Told apart by what each was asked for, not by arrival order: both go
        // out at once, so a counter cannot say which is which.
        const bed = req.instruction.includes('blurred margin');
        seen.push(bed ? 'bed' : 'reframe');
        inFlight += 1;
        if (inFlight > 1) overlapped = true;
        await new Promise((r) => setTimeout(r, 40));
        inFlight -= 1;
        return { images: [core.images.save(await field(marginTone(bed), 456, 256))], costUsd: 0 };
      },
    };
    return { engine, seen: () => seen, overlapped: () => overlapped };
  };

  const growWith = async (engine: EngineAdapter) => {
    const srv = buildServer({ core, engines: registryWith(engine) });
    const brand = await mkBrand();
    const proj = await srv.inject({ method: 'POST', url: '/api/projects', payload: { brandId: brand.id, name: 'p' } });
    const projectId = proj.json().project.id;
    const gen = await srv.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        kind: 'generation',
        engineId: 'moody',
        brief: {
          tokens: [
            { t: 'format', id: 'square', w: 256, h: 256 },
            { t: 'text', v: 'a field' },
          ],
        },
      },
    });
    const base = await waitDoneOn(srv, gen.json().id);
    const grow = await srv.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        parentId: base.id,
        kind: 'edit',
        engineId: 'moody',
        sourceImage: base.images[0],
        reshape: 'extend',
        brief: { tokens: [{ t: 'format', id: 'landscape', w: 456, h: 256 }] },
      },
    });
    expect(grow.statusCode).toBe(202);
    const out = await waitDoneOn(srv, grow.json().id);
    expect(out.status).toBe('done');
    return { srv, base, out };
  };

  it('shows the two draws different frames, and sends them at once', async () => {
    const moody = twoDrawEngine(() => 120);
    const { srv } = await growWith(moody.engine);
    // One asked to fill a blurred margin, one asked for the whole frame again.
    // Ranking two tries of the same request only ever buys the luckier roll.
    expect(moody.seen().sort()).toEqual(['bed', 'reframe']);
    // And both went out together: a second 150-second wait is not a price
    // worth paying.
    expect(moody.overlapped()).toBe(true);
    await srv.close();
  });

  it('keeps the picture byte for byte when the join does not show', async () => {
    // The margin continues the picture's tone, so compositing the original back
    // leaves nothing for the eye to find — and exact pixels cost nothing.
    const moody = twoDrawEngine(() => 120);
    const { srv, base, out } = await growWith(moody.engine);
    const sharpLib = (await import('sharp')).default;
    const src = core.images.read(base.images[0]);
    const meta = await sharpLib(src).metadata();
    const placed = (out.brief as { expand: { left: number; top: number } }).expand;
    const region = { left: placed.left, top: placed.top, width: meta.width!, height: meta.height! };
    const before = await sharpLib(src).removeAlpha().raw().toBuffer();
    const after = await sharpLib(core.images.read(out.images[0])).extract(region).removeAlpha().raw().toBuffer();
    expect(after).toEqual(before);
    await srv.close();
  });

  it('still keeps the picture when one of the two draws dies', async () => {
    /*
     * The two draws are alternatives, not halves, so one survivor is a whole
     * answer — and the survivor is still composited. The bed draw dies here and
     * the padded answer carries the whole job: the picture comes back byte for
     * byte anyway, because every composite is exact in the middle and the
     * padded one had a join nobody could see.
     *
     * The threshold that decides when the photograph is given up instead is
     * unit-tested in outpaint/choose.test.ts against the measured numbers.
     * Reproducing a visibly bad join here is not possible with flat fields:
     * reconciling the margin removes a purely tonal disagreement outright, and
     * the shot that failed in the battery failed structurally, not tonally.
     */
    const sharpLib = (await import('sharp')).default;
    const field = async (v: number, w: number, h: number) =>
      sharpLib({
        create: {
          width: w,
          height: h,
          channels: 3,
          background: { r: v, g: v, b: v },
          noise: { type: 'gaussian', mean: v, sigma: 12 },
        },
      })
        .png()
        .toBuffer();
    const engine: EngineAdapter = {
      capabilities: () => ({
        id: 'moody',
        displayName: 'Moody',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        maxReferenceImages: 0,
      }),
      isAvailable: async () => ({ ok: true }),
      costEstimate: async () => 0,
      generate: async () => ({ images: [core.images.save(await field(120, 256, 256))], costUsd: 0 }),
      edit: async (req) => {
        if (req.instruction.includes('blurred margin')) throw new Error('bed draw timed out');
        return { images: [core.images.save(await field(200, 456, 256))], costUsd: 0 };
      },
    };
    const { srv, base, out } = await growWith(engine);
    // The node succeeded on one draw.
    expect(out.status).toBe('done');
    const meta = await sharpLib(core.images.read(base.images[0])).metadata();
    const grown = await sharpLib(core.images.read(out.images[0])).metadata();
    expect(grown.height).toBe(meta.height);
    expect(grown.width!).toBeGreaterThan(meta.width!);
    // And the surviving draw was composited, not merely kept: the photograph is
    // still there byte for byte.
    const placed = (out.brief as { expand: { left: number; top: number } }).expand;
    const region = { left: placed.left, top: placed.top, width: meta.width!, height: meta.height! };
    const before = await sharpLib(core.images.read(base.images[0])).removeAlpha().raw().toBuffer();
    const after = await sharpLib(core.images.read(out.images[0])).extract(region).removeAlpha().raw().toBuffer();
    expect(after).toEqual(before);
    await srv.close();
  });

  it("fails the node only when both draws fail, and reports the engine's own error", async () => {
    const engine: EngineAdapter = {
      capabilities: () => ({
        id: 'moody',
        displayName: 'Moody',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        maxReferenceImages: 0,
      }),
      isAvailable: async () => ({ ok: true }),
      costEstimate: async () => 0,
      generate: async () => {
        const sharpLib = (await import('sharp')).default;
        const buf = await sharpLib({
          create: { width: 256, height: 256, channels: 3, background: { r: 120, g: 120, b: 120 } },
        })
          .png()
          .toBuffer();
        return { images: [core.images.save(buf)], costUsd: 0 };
      },
      edit: async () => {
        throw new Error('codex exited with code 3: rate limited');
      },
    };
    const srv = buildServer({ core, engines: registryWith(engine) });
    const brand = await mkBrand();
    const proj = await srv.inject({ method: 'POST', url: '/api/projects', payload: { brandId: brand.id, name: 'p' } });
    const projectId = proj.json().project.id;
    const gen = await srv.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        kind: 'generation',
        engineId: 'moody',
        brief: {
          tokens: [
            { t: 'format', id: 'square', w: 256, h: 256 },
            { t: 'text', v: 'a field' },
          ],
        },
      },
    });
    const base = await waitDoneOn(srv, gen.json().id);
    const grow = await srv.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        parentId: base.id,
        kind: 'edit',
        engineId: 'moody',
        sourceImage: base.images[0],
        reshape: 'extend',
        brief: { tokens: [{ t: 'format', id: 'landscape', w: 456, h: 256 }] },
      },
    });
    const out = await waitDoneOn(srv, grow.json().id);
    expect(out.status).toBe('error');
    expect(out.error).toContain('rate limited');
    await srv.close();
  });

  // The other reshape op: no engine, no prompt, no generation — the output is
  // a rectangle of the original's own decoded pixels.
  it('crops to a narrower shape deterministically, pixel for pixel, at no cost', async () => {
    const brand = await mkBrand();
    const { project } = await mkProject(brand.id);
    const gen = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        kind: 'generation',
        engineId: 'demo',
        brief: {
          tokens: [
            { t: 'format', id: 'landscape', w: 456, h: 256 },
            { t: 'text', v: 'a wide field' },
          ],
        },
      },
    });
    const genNode = await waitDone(gen.json().id);
    const sourceHash = genNode.images[0];
    const sharp = (await import('sharp')).default;
    const src = core.images.read(sourceHash);
    const srcMeta = await sharp(src).metadata();

    // aspect-only: a crop needs no words, only the target shape
    const crop = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'demo',
        sourceImage: sourceHash,
        reshape: 'crop',
        brief: { tokens: [{ t: 'format', id: 'square', w: 256, h: 256 }] },
      },
    });
    expect(crop.statusCode).toBe(202);
    const out = await waitDone(crop.json().id);
    expect(out.status).toBe('done');
    expect(out.costUsd).toBe(0);
    expect(out.kind).toBe('edit');
    expect(out.prompt).toContain('Cropped to');
    expect((out.brief as any).reshape).toBe('crop');
    expect((out.brief as any).sourceImage).toBe(sourceHash);
    // no provider was asked, and the record says so
    expect(out.engineId).toBe('local');

    // the output is exactly the RECORDED source window, decoded byte for byte —
    // the window follows the subject now, so the guarantee is byte identity at
    // the rectangle the node names, not a fixed centred position
    const meta = await sharp(core.images.read(out.images[0])).metadata();
    expect(meta.height).toBe(srcMeta.height);
    expect(meta.width).toBe(srcMeta.height); // square from every row
    const window = (out.brief as any).crop;
    expect(window).toMatchObject({ top: 0, width: meta.width, height: meta.height });
    expect(window.left).toBeGreaterThanOrEqual(0);
    expect(window.left + window.width).toBeLessThanOrEqual(srcMeta.width!);
    const before = await sharp(src).extract(window).removeAlpha().raw().toBuffer();
    const after = await sharp(core.images.read(out.images[0])).removeAlpha().raw().toBuffer();
    expect(after).toEqual(before);

    // Try again reposts the stored brief without the top-level reshape field;
    // the crop must stay a crop rather than silently expanding
    const retry = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'demo',
        sourceImage: sourceHash,
        brief: out.brief,
      },
    });
    expect(retry.statusCode).toBe(202);
    const again = await waitDone(retry.json().id);
    expect(again.status).toBe('done');
    expect(again.engineId).toBe('local');
    expect(again.costUsd).toBe(0);
    expect(again.prompt).toContain('Cropped to');
  });

  it('a crop needs no engine, but an aspect-only brief without reshape still refuses', async () => {
    const brand = await mkBrand();
    const { project } = await mkProject(brand.id);
    const gen = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        kind: 'generation',
        engineId: 'demo',
        brief: {
          tokens: [
            { t: 'format', id: 'landscape', w: 456, h: 256 },
            { t: 'text', v: 'a wide field' },
          ],
        },
      },
    });
    const genNode = await waitDone(gen.json().id);

    // an engine nothing here knows: a crop must not care
    const cropped = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'not-installed-anywhere',
        sourceImage: genNode.images[0],
        reshape: 'crop',
        brief: { tokens: [{ t: 'format', id: 'square', w: 256, h: 256 }] },
      },
    });
    expect(cropped.statusCode).toBe(202);
    expect((await waitDone(cropped.json().id)).status).toBe('done');

    // the same aspect-only brief WITHOUT the explicit op is classified by the
    // server now: a squarer target is a crop, never a silent expansion. It
    // used to take the implicit extend path and grow the other axis, which is
    // exactly the op nobody asked for when the target is tighter than the
    // source. The record carries the op the geometry chose.
    const bare = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'demo',
        sourceImage: genNode.images[0],
        brief: { tokens: [{ t: 'format', id: 'square', w: 256, h: 256 }] },
      },
    });
    expect(bare.statusCode).toBe(202);
    const bareOut = await waitDone(bare.json().id);
    expect(bareOut.status).toBe('done');
    expect((bareOut.brief as any).reshape).toBe('crop');
    // pure geometry: no provider was asked and nothing was billed
    expect(bareOut.engineId).toBe('local');
    expect(bareOut.costUsd).toBe(0);

    // a crop to the shape it already has is a caller mistake, said out loud
    const noop = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'demo',
        sourceImage: genNode.images[0],
        reshape: 'crop',
        brief: { tokens: [{ t: 'format', id: 'landscape', w: 456, h: 256 }] },
      },
    });
    expect(noop.statusCode).toBe(400);
    expect(noop.json().error).toMatch(/already this shape/);
  });

  it('an explicit extend needs no prose, and says so when there is nothing to extend', async () => {
    const brand = await mkBrand();
    const { project } = await mkProject(brand.id);
    const gen = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        kind: 'generation',
        engineId: 'demo',
        brief: {
          tokens: [
            { t: 'format', id: 'square', w: 256, h: 256 },
            { t: 'text', v: 'a red field' },
          ],
        },
      },
    });
    const genNode = await waitDone(gen.json().id);

    const extended = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'demo',
        sourceImage: genNode.images[0],
        reshape: 'extend',
        brief: { tokens: [{ t: 'format', id: 'landscape', w: 456, h: 256 }] },
      },
    });
    expect(extended.statusCode).toBe(202);
    const out = await waitDone(extended.json().id);
    expect(out.status).toBe('done');
    expect((out.brief as any).reshape).toBe('extend');

    const noop = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'demo',
        sourceImage: genNode.images[0],
        reshape: 'extend',
        brief: { tokens: [{ t: 'format', id: 'square', w: 256, h: 256 }] },
      },
    });
    expect(noop.statusCode).toBe(400);
    expect(noop.json().error).toMatch(/already this shape/);
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
    const [first, second] = gen.json().siblings as { id: string }[];
    const node = await waitDone(first.id);
    const other = await waitDone(second.id);
    const same = await app.inject({
      method: 'POST',
      url: '/api/diff',
      payload: { imageA: node.images[0], imageB: node.images[0] },
    });
    expect(same.json().score).toBe(0);
    const diff = await app.inject({
      method: 'POST',
      url: '/api/diff',
      payload: { imageA: node.images[0], imageB: other.images[0] },
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

  // A phone stores a portrait photo in its sensor orientation and records the
  // turn in an EXIF tag. Encoding straight to PNG drops that tag, so without
  // applying it first the picture lies on its side forever and nothing
  // downstream can tell that it should not.
  it('bakes in EXIF orientation on upload, so a phone photo is not stored sideways', async () => {
    const sharp = (await import('sharp')).default;
    // 40 wide by 20 tall, tagged "rotate 90" — upright it is 20 by 40.
    const sideways = await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const boundary = '----scexif';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="phone.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
      sideways,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await app.inject({
      method: 'POST',
      url: '/api/images',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(up.statusCode).toBe(200);

    const stored = await sharp(core.images.read(up.json().hash)).metadata();
    expect({ width: stored.width, height: stored.height }).toEqual({ width: 20, height: 40 });
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
    expect(added.json()).toMatchObject({ ok: true, added: 1, nodeIds: [nodeId] });
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
    const feed = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/feed` });
    expect(feed.json().items.some((n: any) => n.id === nodeId)).toBe(true);

    expect((await app.inject({ method: 'DELETE', url: `/api/sets/${setId}` })).json()).toEqual({ ok: true });
    const gone = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    expect(gone.json().sets).toEqual([]);
    const still = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/feed` });
    expect(still.json().items.some((n: any) => n.id === nodeId)).toBe(true);

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

describe('codex setup', () => {
  /** A scripted stand-in for the local Codex CLI, so no test touches a real binary. */
  function fakeSetup(states: ('not-installed' | 'not-authenticated' | 'ready')[]) {
    const seen = { install: 0, login: 0 };
    let i = 0;
    return {
      seen,
      setup: {
        status: async () => ({ state: states[Math.min(i, states.length - 1)], platform: 'mac' as const }),
        install: async () => {
          seen.install++;
          i++;
          return { ok: true };
        },
        login: async () => {
          seen.login++;
          i++;
          return { ok: true };
        },
      },
    };
  }

  it('reports the state the wizard switches on', async () => {
    const { setup } = fakeSetup(['not-installed']);
    const local = buildServer({ core, engines: registryWith(), codexSetup: setup });
    const res = await local.inject({ method: 'GET', url: '/api/engines/codex/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: 'not-installed', platform: 'mac' });
    await local.close();
  });

  it('installs, then reports what the probe now says', async () => {
    const { setup, seen } = fakeSetup(['not-installed', 'not-authenticated']);
    const local = buildServer({ core, engines: registryWith(), codexSetup: setup });
    const res = await local.inject({ method: 'POST', url: '/api/engines/codex/install' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: 'not-authenticated' });
    expect(seen.install).toBe(1);
    await local.close();
  });

  it('signs in, then reports ready', async () => {
    const { setup, seen } = fakeSetup(['not-authenticated', 'ready']);
    const local = buildServer({ core, engines: registryWith(), codexSetup: setup });
    const res = await local.inject({ method: 'POST', url: '/api/engines/codex/login' });
    expect(res.json()).toEqual({ ok: true, state: 'ready' });
    expect(seen.login).toBe(1);
    await local.close();
  });

  it('refuses a second setup run while one is in flight', async () => {
    // Two concurrent global installs fight over the same npm prefix.
    // definite-assignment: the Promise executor runs synchronously, but TS's
    // narrowing can't see that and pins a `| null` initializer to null
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const setup = {
      status: async () => ({ state: 'not-installed' as const, platform: 'mac' as const }),
      install: async () => {
        await gate;
        return { ok: true };
      },
      login: async () => ({ ok: true }),
    };
    const local = buildServer({ core, engines: registryWith(), codexSetup: setup });
    const first = local.inject({ method: 'POST', url: '/api/engines/codex/install' });
    // let the first request take the lock before the second arrives
    await new Promise((r) => setTimeout(r, 10));
    const second = await local.inject({ method: 'POST', url: '/api/engines/codex/install' });
    expect(second.statusCode).toBe(409);
    release();
    await first;
    await local.close();
  });

  it('tells /api/engines which step an engine is missing', async () => {
    const stub: EngineAdapter = {
      capabilities: () => ({
        id: 'codex-cli',
        displayName: 'Codex CLI',
        localOnly: true,
        supportsEdit: true,
        supportsMask: false,
        maxReferenceImages: 6,
      }),
      isAvailable: async () => ({ ok: false, reason: 'not signed in', code: 'not-authenticated' as const }),
      costEstimate: async () => 0,
      generate: async () => ({ images: [], costUsd: 0 }),
      edit: async () => ({ images: [], costUsd: 0 }),
    };
    const local = buildServer({ core, engines: registryWith(stub) });
    const res = await local.inject({ method: 'GET', url: '/api/engines' });
    expect(res.json()[0]).toMatchObject({ available: false, code: 'not-authenticated' });
    await local.close();
  });

  it('reports no code for an engine whose fix is just a key', async () => {
    const local = buildServer({ core, engines: registryWith(createDemoEngine((b) => core.images.save(b))) });
    const res = await local.inject({ method: 'GET', url: '/api/engines' });
    expect(res.json()[0].code).toBeNull();
    await local.close();
  });
});

describe('node watchdog', () => {
  // An engine that never answers and only honors the abort signal: the shape
  // of a hung codex exec whose own timers have failed us.
  const hang = (): EngineAdapter => ({
    capabilities: () => ({
      id: 'hang',
      displayName: 'Hang',
      localOnly: true,
      supportsEdit: false,
      supportsMask: false,
      maxReferenceImages: 0,
    }),
    isAvailable: async () => ({ ok: true }),
    costEstimate: async () => 0,
    generate: (_req, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('engine abort')), { once: true });
      }),
    edit: async () => {
      throw new Error('unsupported');
    },
  });

  it('fails a node that outlives the cap as a timeout, not a cancel', async () => {
    const local = buildServer({ core, engines: registryWith(hang()), nodeTimeoutMs: 300 });
    const b = await local.inject({
      method: 'POST',
      url: '/api/brands',
      payload: { brand: { specVersion: '0.1', meta: { name: 'W' }, palette: { primary: { hex: '#123456' } } } },
    });
    const proj = await local.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { brandId: b.json().id, name: 'w' },
    });
    const gen = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: proj.json().project.id,
        parentId: proj.json().root.id,
        kind: 'generation',
        prompt: 'x',
        engineId: 'hang',
        width: 256,
        height: 256,
      },
    });
    expect(gen.statusCode).toBe(202);
    const node = await waitDoneOn(local, gen.json().id);
    expect(node.status).toBe('error');
    expect(node.error).toMatch(/timed out/i);
    await local.close();
  });

  it('still records a user cancel as cancelled, never as a timeout', async () => {
    const local = buildServer({ core, engines: registryWith(hang()), nodeTimeoutMs: 60_000 });
    const b = await local.inject({
      method: 'POST',
      url: '/api/brands',
      payload: { brand: { specVersion: '0.1', meta: { name: 'W' }, palette: { primary: { hex: '#123456' } } } },
    });
    const proj = await local.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { brandId: b.json().id, name: 'w' },
    });
    const gen = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: proj.json().project.id,
        parentId: proj.json().root.id,
        kind: 'generation',
        prompt: 'x',
        engineId: 'hang',
        width: 256,
        height: 256,
      },
    });
    const cancel = await local.inject({ method: 'POST', url: `/api/nodes/${gen.json().id}/cancel` });
    expect(cancel.statusCode).toBe(200);
    const node = await waitDoneOn(local, gen.json().id);
    expect(node.status).toBe('cancelled');
    await local.close();
  });

  it('cancelling one sibling of a batch cancels the whole shared call', async () => {
    const local = buildServer({ core, engines: registryWith(hang()), nodeTimeoutMs: 60_000 });
    const b = await local.inject({
      method: 'POST',
      url: '/api/brands',
      payload: { brand: { specVersion: '0.1', meta: { name: 'W' }, palette: { primary: { hex: '#123456' } } } },
    });
    const proj = await local.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { brandId: b.json().id, name: 'w' },
    });
    const gen = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: proj.json().project.id,
        parentId: proj.json().root.id,
        kind: 'generation',
        prompt: 'x',
        engineId: 'hang',
        count: 3,
        width: 256,
        height: 256,
      },
    });
    const siblings = gen.json().siblings as { id: string }[];
    expect(siblings).toHaveLength(3);
    // cancel by the LAST sibling's id: one call, one fate, for all three
    const cancel = await local.inject({ method: 'POST', url: `/api/nodes/${siblings[2].id}/cancel` });
    expect(cancel.statusCode).toBe(200);
    for (const s of siblings) {
      const n = await waitDoneOn(local, s.id);
      expect(n.status).toBe('cancelled');
    }
    await local.close();
  });

  it('a partial batch fails only the slots that returned nothing, and bills once', async () => {
    // Two of three slots come back; the adapter names the survivors the way
    // codex does, and the empty slot becomes an honest failed node.
    const partial = (): EngineAdapter => ({
      capabilities: () => ({
        id: 'partial',
        displayName: 'Partial',
        localOnly: true,
        supportsEdit: false,
        supportsMask: false,
        maxReferenceImages: 0,
      }),
      isAvailable: async () => ({ ok: true }),
      costEstimate: async () => 0,
      generate: async (req) => {
        const png = (seed: number) =>
          sharp({
            create: { width: req.width, height: req.height, channels: 3, background: { r: seed, g: 10, b: 10 } },
          })
            .png()
            .toBuffer();
        return {
          images: [core.images.save(await png(40)), core.images.save(await png(200))],
          costUsd: 0.3,
          raw: { requested: 3, variantIndexes: [0, 2], partialFailures: ['slot two refused'] },
        };
      },
      edit: async () => {
        throw new Error('unsupported');
      },
    });
    const local = buildServer({ core, engines: registryWith(partial()) });
    const b = await local.inject({
      method: 'POST',
      url: '/api/brands',
      payload: { brand: { specVersion: '0.1', meta: { name: 'W' }, palette: { primary: { hex: '#123456' } } } },
    });
    const proj = await local.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { brandId: b.json().id, name: 'w' },
    });
    const gen = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: proj.json().project.id,
        parentId: proj.json().root.id,
        kind: 'generation',
        prompt: 'x',
        engineId: 'partial',
        count: 3,
        width: 64,
        height: 64,
      },
    });
    const siblings = gen.json().siblings as { id: string }[];
    const first = await waitDoneOn(local, siblings[0].id);
    const second = await waitDoneOn(local, siblings[1].id);
    const third = await waitDoneOn(local, siblings[2].id);
    expect(first.status).toBe('done');
    expect(third.status).toBe('done');
    expect(second.status).toBe('error');
    expect(second.error).toBe('slot two refused');
    // the whole call's money sits on the first sibling, once — written after
    // the last slot settles, so it is read back rather than taken from the
    // snapshot that saw the first sibling finish
    const charged = (await local.inject({ method: 'GET', url: `/api/nodes/${first.id}` })).json();
    expect(charged.costUsd).toBeCloseTo(0.3);
    expect(third.costUsd).toBe(0);
    await local.close();
  });
});

// The reported contract failure: a refinement claimed identity was preserved
// while the inherited brand mark and reference never reached the engine, and
// the record showed none of what was carried.
describe('a refinement carries marks and references, not just subjects', () => {
  const capture = (maxReferenceImages: number) => {
    const edits: EditRequest[] = [];
    const engine: EngineAdapter = {
      capabilities: () => ({
        id: 'cap-spy',
        displayName: 'Cap Spy',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        maxReferenceImages,
      }),
      isAvailable: async () => ({ ok: true }),
      costEstimate: async () => 0,
      generate: async () => ({ images: [core.images.save(PNG_1PX)], costUsd: 0 }),
      edit: async (req) => {
        edits.push(req);
        return { images: [core.images.save(PNG_1PX)], costUsd: 0 };
      },
    };
    return { engine, edits };
  };

  const seed = async (local: ReturnType<typeof buildServer>) => {
    const productHash = core.images.save(PNG_1PX);
    const logoHash = core.images.save(Buffer.concat([PNG_1PX, Buffer.from([1])]));
    const refHash = core.images.save(Buffer.concat([PNG_1PX, Buffer.from([2])]));
    const made = await local.inject({
      method: 'POST',
      url: '/api/brands',
      payload: {
        brand: {
          specVersion: '0.1',
          meta: { name: 'Acme' },
          products: [{ id: 'p1', name: 'House Blend', shots: [{ file: `asset:${productHash}`, locked: true }] }],
          logos: [{ role: 'primary', file: `asset:${logoHash}` }],
        },
      },
    });
    const brand = made.json();
    const ws = await local.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    const projectId = ws.json().project.id;
    const gen = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        kind: 'generation',
        engineId: 'cap-spy',
        brief: {
          tokens: [
            { t: 'format', id: 'square', w: 1024, h: 1024 },
            { t: 'product', id: 'p1' },
            { t: 'text', v: 'on a stone ledge' },
            { t: 'mark', imageHash: logoHash },
            { t: 'ref', imageHash: refHash },
          ],
        },
      },
    });
    expect(gen.statusCode).toBe(202);
    const genNode = await waitDoneOn(local, gen.json().id);
    expect(genNode.status).toBe('done');
    return { brand, projectId, genNode, productHash, logoHash, refHash };
  };

  it('an inherited mark and reference reach the engine, and the record says so', async () => {
    const { engine, edits } = capture(6);
    const local = buildServer({ core, engines: registryWith(engine) });
    const { brand, projectId, genNode, productHash, logoHash, refHash } = await seed(local);

    const edit = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'cap-spy',
        sourceImage: genNode.images[0],
        brief: { tokens: [{ t: 'text', v: 'warmer light' }] },
      },
    });
    expect(edit.statusCode).toBe(202);
    const editNode = await waitDoneOn(local, edit.json().id);
    expect(editNode.status).toBe('done');

    // the engine received all three carried images, with their real roles
    const req = edits[0];
    expect(req.referenceImages).toContain(core.images.pathFor(productHash));
    expect(req.referenceImages).toContain(core.images.pathFor(logoHash));
    expect(req.referenceImages).toContain(core.images.pathFor(refHash));
    expect(req.referenceRoles).toEqual(expect.arrayContaining(['product', 'brand', 'reference']));

    // the record keeps what was carried apart from what was asked
    const brief = editNode.brief as any;
    expect(brief.tokens).toEqual([{ t: 'text', v: 'warmer light' }]);
    expect((brief.inherited ?? []).map((t: any) => t.t).sort()).toEqual(['mark', 'product', 'ref']);

    // the carried mood image is scoped, not claimed as the subject: the
    // identity sentence names only the product (no person rode), and the ref
    // gets its own composition-only sentence
    expect(editNode.prompt).toContain('the same product that is already in this picture');
    expect(editNode.prompt).not.toContain('and the same person');
    expect(editNode.prompt).toContain('The carried reference is attached for composition, lighting and treatment only');

    // and the preview with a parent tells the same story before sending
    const preview = await local.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: {
        brandId: brand.id,
        engineId: 'cap-spy',
        parentId: genNode.id,
        brief: { tokens: [{ t: 'text', v: 'x' }] },
      },
    });
    expect(preview.statusCode).toBe(200);
    const atts = preview.json().attachments as any[];
    expect(
      atts
        .filter((a) => a.inherited)
        .map((a) => a.role)
        .sort(),
    ).toEqual(['brand', 'product', 'reference']);

    // without a parent the preview is exactly what it always was
    const bare = await local.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: { brandId: brand.id, engineId: 'cap-spy', brief: { tokens: [{ t: 'text', v: 'x' }] } },
    });
    expect(bare.json().attachments).toEqual([]);
    await local.close();
  });

  // The synthetic identity compile's warnings used to be discarded, so a mark
  // whose logo left the kit between the shot and its refine dropped with
  // nothing said to anyone - the silent brand-fidelity loss, fixed here.
  it('a refine says when a carried mark has since left the kit', async () => {
    const { engine } = capture(6);
    const local = buildServer({ core, engines: registryWith(engine) });
    const { brand, projectId, genNode, logoHash } = await seed(local);

    const del = await local.inject({ method: 'DELETE', url: `/api/brands/${brand.id}/logos/${logoHash}` });
    expect(del.statusCode).toBe(200);

    // the preview with a parent says it before anything is spent
    const preview = await local.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: {
        brandId: brand.id,
        engineId: 'cap-spy',
        parentId: genNode.id,
        brief: { tokens: [{ t: 'text', v: 'x' }] },
      },
    });
    expect(preview.statusCode).toBe(200);
    expect((preview.json().warnings ?? []).join(' ')).toContain('no longer in the kit');

    // and the send repeats it on the 202
    const edit = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'cap-spy',
        sourceImage: genNode.images[0],
        brief: { tokens: [{ t: 'text', v: 'warmer light' }] },
      },
    });
    expect(edit.statusCode).toBe(202);
    expect((edit.json().warnings ?? []).join(' ')).toContain('no longer in the kit');
    await waitDoneOn(local, edit.json().id);
    await local.close();
  });

  // The edit path's wire payload is asserted above; this is the generation
  // path's: the mark reaches the engine as the original stored PNG, with the
  // brand role at the matching index.
  it('a generation sends the original stored mark with the brand role at its index', async () => {
    const gens: GenerateRequest[] = [];
    const engine: EngineAdapter = {
      capabilities: () => ({
        id: 'cap-spy',
        displayName: 'Cap Spy',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        maxReferenceImages: 5,
      }),
      isAvailable: async () => ({ ok: true }),
      costEstimate: async () => 0,
      generate: async (req) => {
        gens.push(req);
        return { images: [core.images.save(PNG_1PX)], costUsd: 0 };
      },
      edit: async () => ({ images: [core.images.save(PNG_1PX)], costUsd: 0 }),
    };
    const local = buildServer({ core, engines: registryWith(engine) });
    const { logoHash } = await seed(local);
    const req = gens[0];
    const idx = req.referenceImages?.indexOf(core.images.pathFor(logoHash)) ?? -1;
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(req.referenceRoles?.[idx]).toBe('brand');
    await local.close();
  });

  it('under a tight budget the subject boards first and the rest is carried in words, not announced as lost', async () => {
    const { engine, edits } = capture(2); // the source frame keeps one slot: one left
    const local = buildServer({ core, engines: registryWith(engine) });
    const { projectId, genNode, productHash } = await seed(local);

    const edit = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'cap-spy',
        sourceImage: genNode.images[0],
        brief: { tokens: [{ t: 'text', v: 'warmer light' }] },
      },
    });
    expect(edit.statusCode).toBe(202);
    // The composer dimmed the seatless chip and said "described in words"
    // before the send; a toast saying it "was left out" would contradict it.
    expect((edit.json().warnings ?? []).join(' ')).not.toMatch(/left out/);
    await waitDoneOn(local, edit.json().id);

    expect(edits[0].referenceImages).toEqual([core.images.pathFor(productHash)]);
    expect(edits[0].referenceRoles).toEqual(['product']);
    await local.close();
  });
});

// The reported decay: engines given no size on a plain refine answered at
// whatever size they liked, the shrunken answer was stored, and the next
// refinement inherited it. And once an engine drifted the ratio, every later
// plain refine compared those pixels against the unchanged nominal format and
// silently became an outpaint of the drift.
describe('a refinement keeps its canvas', () => {
  const png = (w: number, h: number) =>
    sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 130, b: 140 } } })
      .png()
      .toBuffer();

  const sizeSpy = () => {
    const edits: EditRequest[] = [];
    const state = {
      genSize: { width: 320, height: 400 },
      // null answers at the requested size, the honest engine
      editSize: null as { width: number; height: number } | null,
    };
    const engine: EngineAdapter = {
      capabilities: () => ({
        id: 'size-spy',
        displayName: 'Size Spy',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        maxReferenceImages: 5,
      }),
      isAvailable: async () => ({ ok: true }),
      costEstimate: async () => 0,
      generate: async () => ({
        images: [core.images.save(await png(state.genSize.width, state.genSize.height))],
        costUsd: 0,
      }),
      edit: async (req) => {
        edits.push(req);
        const size = state.editSize ?? { width: req.width ?? 64, height: req.height ?? 64 };
        return { images: [core.images.save(await png(size.width, size.height))], costUsd: 0 };
      },
    };
    return { engine, edits, state };
  };

  const seed = async (local: FastifyInstance, format: { w: number; h: number }, text = 'a bottle on a ledge') => {
    const made = await local.inject({
      method: 'POST',
      url: '/api/brands',
      payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' }, palette: { primary: { hex: '#1F3D2B' } } } },
    });
    const brand = made.json();
    const proj = await local.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { brandId: brand.id, name: 'c' },
    });
    const project = proj.json().project;
    const gen = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        kind: 'generation',
        engineId: 'size-spy',
        brief: {
          tokens: [
            { t: 'format', id: 'portrait', w: format.w, h: format.h },
            { t: 'text', v: text },
          ],
        },
      },
    });
    const genNode = await waitDoneOn(local, gen.json().id);
    expect(genNode.status).toBe('done');
    return { project, genNode };
  };

  const refine = (local: FastifyInstance, project: any, genNode: any, format: { w: number; h: number }, text: string) =>
    local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'size-spy',
        sourceImage: genNode.images[0],
        brief: {
          tokens: [
            { t: 'format', id: 'portrait', w: format.w, h: format.h },
            { t: 'text', v: text },
          ],
        },
      },
    });

  it('states the source pixels to the engine, and ratio drift never becomes an outpaint', {
    timeout: 20_000,
  }, async () => {
    const { engine, edits, state } = sizeSpy();
    const local = buildServer({ core, engines: registryWith(engine) });
    try {
      // The engine drifts the 4:5 request to 3:4 pixels, inside the aspect
      // tolerance; the thread's nominal format stays 4:5.
      state.genSize = { width: 360, height: 480 };
      const { project, genNode } = await seed(local, { w: 320, h: 400 });

      // The drifted 3:4 answer to a 4:5 ask is conformed at the generation:
      // an attention CROP to the asked ratio at the frame's own scale - never
      // a resample, never a shear - recorded as croppedFrom.
      expect(genNode.brief?.croppedFrom).toEqual([360, 480]);
      expect(genNode.brief?.rendered?.sizes?.[0]).toEqual([360, 450]);
      expect(genNode.brief?.rendered?.requestedSize).toEqual([320, 400]);

      const edit = await refine(local, project, genNode, { w: 320, h: 400 }, 'a more editorial and cinematic feel');
      expect(edit.statusCode).toBe(202);
      const editNode = await waitDoneOn(local, edit.json().id);

      expect(editNode.status).toBe('done');
      // One plain draw at the source's real pixels: no bed, no reframe pair.
      expect(edits).toHaveLength(1);
      expect(edits[0].width).toBe(360);
      expect(edits[0].height).toBe(450);
      expect(edits[0].instruction).toContain('a more editorial and cinematic feel');
      expect(edits[0].instruction).not.toContain('blurred margin');
      expect(edits[0].instruction).not.toContain('Redraw this photograph');
    } finally {
      await local.close();
    }
  });

  it('resamples a same-shape shrunken answer back onto the source canvas, and says so', {
    timeout: 20_000,
  }, async () => {
    const { engine, state } = sizeSpy();
    const local = buildServer({ core, engines: registryWith(engine) });
    try {
      state.genSize = { width: 320, height: 400 };
      const { project, genNode } = await seed(local, { w: 320, h: 400 });

      state.editSize = { width: 288, height: 360 }; // 90%, same shape
      const edit = await refine(local, project, genNode, { w: 320, h: 400 }, 'a more editorial and cinematic feel');
      const editNode = await waitRenderedOn(local, edit.json().id);

      expect(editNode.status).toBe('done');
      const meta = await sharp(core.images.read(editNode.images[0])).metadata();
      expect([meta.width, meta.height]).toEqual([320, 400]);
      expect(editNode.brief?.resizedFrom).toEqual([288, 360]);
      expect(editNode.brief?.rendered?.sizes?.[0]).toEqual([320, 400]);
    } finally {
      await local.close();
    }
  });

  it('fails an answer below the floor rather than shrinking the thread', { timeout: 20_000 }, async () => {
    const { engine, state } = sizeSpy();
    const local = buildServer({ core, engines: registryWith(engine) });
    try {
      state.genSize = { width: 320, height: 400 };
      const { project, genNode } = await seed(local, { w: 320, h: 400 });

      state.editSize = { width: 160, height: 200 }; // 50%, same shape
      const edit = await refine(local, project, genNode, { w: 320, h: 400 }, 'a more editorial and cinematic feel');
      const editNode = await waitDoneOn(local, edit.json().id);

      expect(editNode.status).toBe('error');
      expect(String(editNode.error)).toContain('too little of the picture');
    } finally {
      await local.close();
    }
  });

  it('an exact answer is stored untouched', { timeout: 20_000 }, async () => {
    const { engine, state } = sizeSpy();
    const local = buildServer({ core, engines: registryWith(engine) });
    try {
      state.genSize = { width: 320, height: 400 };
      const { project, genNode } = await seed(local, { w: 320, h: 400 });

      const edit = await refine(local, project, genNode, { w: 320, h: 400 }, 'a more editorial and cinematic feel');
      const editNode = await waitDoneOn(local, edit.json().id);

      expect(editNode.status).toBe('done');
      const meta = await sharp(core.images.read(editNode.images[0])).metadata();
      expect([meta.width, meta.height]).toEqual([320, 400]);
      expect(editNode.brief?.resizedFrom).toBeUndefined();
    } finally {
      await local.close();
    }
  });

  it('a genuinely different format is still an implicit expansion', { timeout: 20_000 }, async () => {
    const { engine, edits, state } = sizeSpy();
    const local = buildServer({ core, engines: registryWith(engine) });
    try {
      state.genSize = { width: 320, height: 400 };
      const { project, genNode } = await seed(local, { w: 320, h: 400 });

      const edit = await refine(local, project, genNode, { w: 512, h: 288 }, 'more of the ledge');
      expect(edit.statusCode).toBe(202);
      // The no-mask route draws twice at once: the bed and the reframe.
      await expect.poll(() => edits.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
      const texts = edits.map((e) => e.instruction).join('\n---\n');
      expect(texts).toContain('so the photograph continues into it');
      expect(texts).toContain('Redraw this photograph');
      // Drain before teardown, whatever the assembled outcome is.
      await waitDoneOn(local, edit.json().id);
    } finally {
      await local.close();
    }
  });
});

// The chain decay: identity survived exactly one refine well. The walk died
// silently at 8 hops, corroboration angles never rode, and the record's own
// facts (dimensions, preservation notes, the identity lock) vanished from
// every refinement while its prompt claimed identity was preserved.
describe('a refinement chain keeps the whole identity record', () => {
  const capture = (maxReferenceImages: number) => {
    const edits: EditRequest[] = [];
    const engine: EngineAdapter = {
      capabilities: () => ({
        id: 'chain-spy',
        displayName: 'Chain Spy',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        maxReferenceImages,
      }),
      isAvailable: async () => ({ ok: true }),
      costEstimate: async () => 0,
      generate: async () => ({ images: [core.images.save(PNG_1PX)], costUsd: 0 }),
      edit: async (req) => {
        edits.push(req);
        return { images: [core.images.save(PNG_1PX)], costUsd: 0 };
      },
    };
    return { engine, edits };
  };

  const seedChain = async (local: FastifyInstance, shots: 1 | 2, withMarkAndRef = false) => {
    const productHash = core.images.save(PNG_1PX);
    const angleHash = core.images.save(Buffer.concat([PNG_1PX, Buffer.from([9])]));
    const logoHash = core.images.save(Buffer.concat([PNG_1PX, Buffer.from([1])]));
    const refHash = core.images.save(Buffer.concat([PNG_1PX, Buffer.from([2])]));
    const made = await local.inject({
      method: 'POST',
      url: '/api/brands',
      payload: {
        brand: {
          specVersion: '0.1',
          meta: { name: 'Acme' },
          products: [
            {
              id: 'p1',
              name: 'House Blend',
              dimensions: '66mm across, 115mm tall',
              shots: [
                { file: `asset:${productHash}`, angle: 'front', locked: true },
                ...(shots === 2 ? [{ file: `asset:${angleHash}`, angle: 'back', locked: true }] : []),
              ],
            },
          ],
          ...(withMarkAndRef ? { logos: [{ role: 'primary', file: `asset:${logoHash}` }] } : {}),
        },
      },
    });
    const brand = made.json();
    const ws = await local.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    const projectId = ws.json().project.id;
    const gen = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        kind: 'generation',
        engineId: 'chain-spy',
        brief: {
          tokens: [
            { t: 'format', id: 'square', w: 1024, h: 1024 },
            { t: 'product', id: 'p1' },
            { t: 'text', v: 'on a stone ledge' },
            ...(withMarkAndRef
              ? [
                  { t: 'mark', imageHash: logoHash },
                  { t: 'ref', imageHash: refHash },
                ]
              : []),
          ],
        },
      },
    });
    const genNode = await waitDoneOn(local, gen.json().id);
    expect(genNode.status).toBe('done');
    return { projectId, genNode, productHash, angleHash, logoHash, refHash };
  };

  const refineOf = async (local: FastifyInstance, projectId: string, parent: any, text: string) => {
    const res = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        parentId: parent.id,
        kind: 'edit',
        engineId: 'chain-spy',
        sourceImage: parent.images[0],
        brief: { tokens: [{ t: 'text', v: text }] },
      },
    });
    expect(res.statusCode).toBe(202);
    const node = await waitDoneOn(local, res.json().id);
    return { node, warnings: res.json().warnings ?? [] };
  };

  it('the third refinement still carries the product, and states its facts', { timeout: 30_000 }, async () => {
    const { engine, edits } = capture(6);
    const local = buildServer({ core, engines: registryWith(engine) });
    try {
      const { projectId, genNode, productHash } = await seedChain(local, 1);
      const { node: e1 } = await refineOf(local, projectId, genNode, 'a more editorial and cinematic feel');
      const { node: e2 } = await refineOf(local, projectId, e1, 'softer background');
      const { node: e3 } = await refineOf(local, projectId, e2, 'clean up the hand');

      for (const [i, node] of [e1, e2, e3].entries()) {
        expect(node.status).toBe('done');
        // The engine received the canonical product reference at every hop.
        expect(edits[i].referenceImages).toContain(core.images.pathFor(productHash));
        // The identity contract is stated in edit terms, with the record's
        // own facts beside it, not just a generic "same product" sentence.
        expect(node.prompt).toContain('the exact product already in this photograph');
        expect(node.prompt).toContain('Its real-world size is 66mm across, 115mm tall');
        // And each refinement re-records the union for the next one.
        expect(((node.brief as any).inherited ?? []).map((t: any) => t.t)).toContain('product');
      }
    } finally {
      await local.close();
    }
  });

  it('a product borrows one corroboration angle when the budget has room', { timeout: 20_000 }, async () => {
    const { engine, edits } = capture(6);
    const local = buildServer({ core, engines: registryWith(engine) });
    try {
      const { projectId, genNode, productHash, angleHash } = await seedChain(local, 2);
      await refineOf(local, projectId, genNode, 'a more editorial and cinematic feel');
      expect(edits[0].referenceImages).toContain(core.images.pathFor(productHash));
      expect(edits[0].referenceImages).toContain(core.images.pathFor(angleHash));
      expect(edits[0].referenceRoles?.filter((r) => r === 'product')).toHaveLength(2);
    } finally {
      await local.close();
    }
  });

  it('a full frame on a tight budget degrades the extra angle quietly', { timeout: 20_000 }, async () => {
    // Four images total, the source frame keeps one: product essential, mark
    // and reference are seated, the corroboration angle is not - and the
    // warning must not read as though the product itself was left out.
    const { engine, edits } = capture(4);
    const local = buildServer({ core, engines: registryWith(engine) });
    try {
      const { projectId, genNode, productHash, angleHash, logoHash, refHash } = await seedChain(local, 2, true);
      const { warnings } = await refineOf(local, projectId, genNode, 'a more editorial and cinematic feel');
      expect(edits[0].referenceImages).toContain(core.images.pathFor(productHash));
      expect(edits[0].referenceImages).toContain(core.images.pathFor(logoHash));
      expect(edits[0].referenceImages).toContain(core.images.pathFor(refHash));
      expect(edits[0].referenceImages).not.toContain(core.images.pathFor(angleHash));
      expect(warnings.join(' ')).not.toContain('House Blend');
    } finally {
      await local.close();
    }
  });
});

// PR-C: validation, orientation, and the crop-to-canvas fallback.
describe('engine images are validated, oriented, and conformed before storing', () => {
  const png = (w: number, h: number) =>
    sharp({ create: { width: w, height: h, channels: 3, background: { r: 90, g: 110, b: 130 } } })
      .png()
      .toBuffer();

  const shapedSpy = () => {
    const state = {
      genSize: { width: 320, height: 400 },
      genBuf: null as Buffer | null,
      editSize: null as { width: number; height: number } | null,
    };
    const edits: EditRequest[] = [];
    const engine: EngineAdapter = {
      capabilities: () => ({
        id: 'shape-spy',
        displayName: 'Shape Spy',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        maxReferenceImages: 5,
      }),
      isAvailable: async () => ({ ok: true }),
      costEstimate: async () => 0,
      generate: async () => ({
        images: [core.images.save(state.genBuf ?? (await png(state.genSize.width, state.genSize.height)))],
        costUsd: 0,
      }),
      edit: async (req) => {
        edits.push(req);
        const size = state.editSize ?? { width: req.width ?? 64, height: req.height ?? 64 };
        return { images: [core.images.save(await png(size.width, size.height))], costUsd: 0 };
      },
    };
    return { engine, edits, state };
  };

  const seedShaped = async (local: FastifyInstance, format: { w: number; h: number }, text = 'a bottle on a ledge') => {
    const made = await local.inject({
      method: 'POST',
      url: '/api/brands',
      payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' }, palette: { primary: { hex: '#1F3D2B' } } } },
    });
    const brand = made.json();
    const proj = await local.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { brandId: brand.id, name: 'c' },
    });
    const project = proj.json().project;
    const gen = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.id,
        kind: 'generation',
        engineId: 'shape-spy',
        brief: {
          tokens: [
            { t: 'format', id: 'portrait', w: format.w, h: format.h },
            { t: 'text', v: text },
          ],
        },
      },
    });
    const genNode = await waitDoneOn(local, gen.json().id);
    return { project, genNode };
  };

  it('an orientation-tagged answer is stored upright, and a clean PNG passes hash-identical', {
    timeout: 20_000,
  }, async () => {
    const { engine, state } = shapedSpy();
    const local = buildServer({ core, engines: registryWith(engine) });
    try {
      // landscape pixels tagged to display portrait: after normalization the
      // stored file must MEASURE portrait, so every surface agrees with sharp
      state.genBuf = await sharp({
        create: { width: 400, height: 320, channels: 3, background: { r: 90, g: 110, b: 130 } },
      })
        .withMetadata({ orientation: 6 })
        .png()
        .toBuffer();
      const { genNode } = await seedShaped(local, { w: 320, h: 400 });
      expect(genNode.status).toBe('done');
      const meta = await sharp(core.images.read(genNode.images[0])).metadata();
      expect([meta.width, meta.height]).toEqual([320, 400]);
      expect((meta.orientation ?? 1) === 1).toBe(true);
    } finally {
      await local.close();
    }
  });

  it('the real-world tail: a 20 percent drifted answer is cropped, not failed', { timeout: 20_000 }, async () => {
    const { engine, state } = shapedSpy();
    const local = buildServer({ core, engines: registryWith(engine) });
    try {
      // the release-night wall: figure prompts pulled the tool to 1003x1568
      // for a 1024x1280 ask, 20.04 percent off - inside the net now
      state.genBuf = await png(1003, 1568);
      const { genNode } = await seedShaped(local, { w: 1024, h: 1280 });
      expect(genNode.status).toBe('done');
      expect(genNode.brief?.croppedFrom).toEqual([1003, 1568]);
      const meta = await sharp(core.images.read(genNode.images[0])).metadata();
      expect(Math.abs((meta.width ?? 0) / (meta.height ?? 1) - 1024 / 1280)).toBeLessThan(0.02);
    } finally {
      await local.close();
    }
  });

  it('an unrelated shape still fails the node', { timeout: 20_000 }, async () => {
    const { engine, state } = shapedSpy();
    const local = buildServer({ core, engines: registryWith(engine) });
    try {
      state.genBuf = await png(500, 320); // landscape for a portrait ask, ~95 percent off
      const { genNode } = await seedShaped(local, { w: 1024, h: 1280 });
      expect(genNode.status).toBe('error');
      expect(String(genNode.error)).toContain('cannot produce the requested aspect ratio');
    } finally {
      await local.close();
    }
  });

  it('undecodable engine output fails the node with a clear message', { timeout: 20_000 }, async () => {
    const { engine, state } = shapedSpy();
    const local = buildServer({ core, engines: registryWith(engine) });
    try {
      state.genBuf = Buffer.from('this is not an image at all');
      const { genNode } = await seedShaped(local, { w: 320, h: 400 });
      expect(genNode.status).toBe('error');
      expect(String(genNode.error)).toContain('undecodable');
    } finally {
      await local.close();
    }
  });

  it('a global refine whose answer drifted shape is cropped, then finished by the canvas pass', {
    timeout: 20_000,
  }, async () => {
    const { engine, state, edits } = shapedSpy();
    const local = buildServer({ core, engines: registryWith(engine) });
    try {
      const { project, genNode } = await seedShaped(local, { w: 320, h: 400 });
      expect(genNode.status).toBe('done');
      // engine answers the 4:5 refine at 3:4 and larger: crop to 4:5 at its
      // own scale (360x450), then one lanczos down onto the 320x400 canvas
      state.editSize = { width: 360, height: 480 };
      const edit = await local.inject({
        method: 'POST',
        url: '/api/nodes',
        payload: {
          projectId: project.id,
          parentId: genNode.id,
          kind: 'edit',
          engineId: 'shape-spy',
          sourceImage: genNode.images[0],
          brief: {
            tokens: [
              { t: 'format', id: 'portrait', w: 320, h: 400 },
              { t: 'text', v: 'a more editorial and cinematic feel' },
            ],
          },
        },
      });
      const editNode = await waitRenderedOn(local, edit.json().id);
      expect(editNode.status).toBe('done');
      const meta = await sharp(core.images.read(editNode.images[0])).metadata();
      expect([meta.width, meta.height]).toEqual([320, 400]);
      expect(editNode.brief?.croppedFrom).toEqual([360, 480]);
      expect(editNode.brief?.resizedFrom).toEqual([360, 450]);
      expect(editNode.brief?.resampledHops).toBe(1);
      expect(edits).toHaveLength(1);
    } finally {
      await local.close();
    }
  });
});

// A fixed-budget engine cannot answer an over-budget source at its own size.
// The old contract upscaled its native answer back - a stored size the pixels
// could not fill, re-laundered on every hop. The thread now steps down once,
// honestly: the engine gets a deterministic downscale at its own budget, its
// native answer is kept, and the record says so.
describe('refines on a pixel-budget engine step down honestly', () => {
  const png = (w: number, h: number) =>
    sharp({ create: { width: w, height: h, channels: 3, background: '#446688' } })
      .png()
      .toBuffer();
  const budgetEngine = () => {
    const edits: EditRequest[] = [];
    const engine: EngineAdapter = {
      capabilities: () => ({
        id: 'budget-spy',
        displayName: 'Budget Spy',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        maxReferenceImages: 4,
        editPixelBudget: 6400, // 80x80 - a toy codex
      }),
      isAvailable: async () => ({ ok: true }),
      costEstimate: async () => 0,
      // generations come back oversized on purpose: a 100x100 source
      generate: async () => ({ images: [core.images.save(await png(100, 100))], costUsd: 0 }),
      // the edit answers at its true budget size, whatever it was sent
      edit: async (req) => {
        edits.push(req);
        return { images: [core.images.save(await png(80, 80))], costUsd: 0 };
      },
    };
    return { engine, edits };
  };

  it('a frame a few pixels over the budget steps down to its own size, which is no step at all', async () => {
    const { engine, edits } = budgetEngine();
    // 82x79 is 6478 pixels: over a 6400 budget, and budgetSize rounds it
    // straight back to 82x79. Nothing to resample, nothing to announce.
    engine.generate = async () => ({ images: [core.images.save(await png(82, 79))], costUsd: 0 });
    engine.edit = async (req) => {
      edits.push(req);
      return { images: [core.images.save(await png(82, 79))], costUsd: 0 };
    };
    const local = buildServer({ core, engines: registryWith(engine) });
    const brand = (
      await local.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' } } },
      })
    ).json();
    const ws = await local.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    const projectId = ws.json().project.id;
    const gen = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        kind: 'generation',
        engineId: 'budget-spy',
        brief: {
          tokens: [
            { t: 'format', id: 'square', w: 82, h: 79 },
            { t: 'text', v: 'a mug' },
          ],
        },
      },
    });
    const genNode = await waitDoneOn(local, gen.json().id);
    const edit = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'budget-spy',
        sourceImage: genNode.images[0],
        brief: { tokens: [{ t: 'text', v: 'warmer light' }] },
      },
    });
    expect(edit.statusCode).toBe(202);
    expect((edit.json().warnings ?? []).join(' ')).not.toContain('continues at');
    const editNode = await waitRenderedOn(local, edit.json().id);
    expect(editNode.status).toBe('done');
    const sent = await sharp(edits[0].sourceImage).metadata();
    expect([sent.width, sent.height]).toEqual([82, 79]);
    expect((editNode.brief as any).steppedDown).toBeUndefined();
    await local.close();
  });

  it('sends the budget-size source, keeps the native answer, and records the step-down once', async () => {
    const { engine, edits } = budgetEngine();
    const local = buildServer({ core, engines: registryWith(engine) });
    const brand = (
      await local.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' } } },
      })
    ).json();
    const ws = await local.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    const projectId = ws.json().project.id;
    const gen = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        kind: 'generation',
        engineId: 'budget-spy',
        brief: {
          tokens: [
            { t: 'format', id: 'square', w: 100, h: 100 },
            { t: 'text', v: 'a mug' },
          ],
        },
      },
    });
    const genNode = await waitDoneOn(local, gen.json().id);

    const edit = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'budget-spy',
        sourceImage: genNode.images[0],
        brief: { tokens: [{ t: 'text', v: 'a more editorial and cinematic feel' }] },
      },
    });
    expect(edit.statusCode).toBe(202);
    // the 202 says it out loud, once, with real numbers
    expect((edit.json().warnings ?? []).join(' ')).toContain('continues at 80x80 from here on');

    const editNode = await waitRenderedOn(local, edit.json().id);
    expect(editNode.status).toBe('done');

    // the engine was sent the deterministic downscale, not the full frame
    const sent = await sharp(edits[0].sourceImage).metadata();
    expect([sent.width, sent.height]).toEqual([80, 80]);
    expect([edits[0].width, edits[0].height]).toEqual([80, 80]);

    // the native answer was stored untouched - not inflated back to 100
    const stored = await sharp(core.images.read(editNode.images[0])).metadata();
    expect([stored.width, stored.height]).toEqual([80, 80]);
    const brief = editNode.brief as any;
    expect(brief.steppedDown).toEqual([100, 100]);
    expect(brief.resampledHops).toBeUndefined();
    expect(brief.rendered?.sizes?.[0]).toEqual([80, 80]);

    // the next hop is already at budget: no second step-down, no warning
    const edit2 = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        parentId: editNode.id,
        kind: 'edit',
        engineId: 'budget-spy',
        sourceImage: editNode.images[0],
        brief: { tokens: [{ t: 'text', v: 'a flatter, more clinical feel' }] },
      },
    });
    expect((edit2.json().warnings ?? []).join(' ')).not.toContain('continues at');
    const edit2Node = await waitRenderedOn(local, edit2.json().id);
    expect((edit2Node.brief as any).steppedDown).toBeUndefined();
    const stored2 = await sharp(core.images.read(edit2Node.images[0])).metadata();
    expect([stored2.width, stored2.height]).toEqual([80, 80]);

    // and a retry never re-persists the run record
    const retry = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'budget-spy',
        sourceImage: genNode.images[0],
        brief: { ...(editNode.brief as object), tokens: [{ t: 'text', v: 'a more editorial and cinematic feel' }] },
      },
    });
    const retryNode = await waitDoneOn(local, retry.json().id);
    // its own run steps down again (same oversized source), but the STALE
    // steppedDown from the copied brief never rode in as an input
    expect((retryNode.brief as any).steppedDown).toEqual([100, 100]);
    await local.close();
  });
});

// The scene-photograph gate on refines, pinned at the route level: a thread
// whose generation was conditioned on a figure-led custom scene must never
// re-expose that scene's image on an edit - the photograph being refined
// carries its world. Two layers hold this (IDENTITY_KINDS excludes template;
// the synthetic identity compile declares edit mode); this test fails if
// BOTH ever give way.
describe('a refinement never re-sends scene imagery', () => {
  it('the edit request of a custom-scene thread carries no scene role', async () => {
    const edits: EditRequest[] = [];
    const engine: EngineAdapter = {
      capabilities: () => ({
        id: 'scene-spy',
        displayName: 'Scene Spy',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        maxReferenceImages: 6,
      }),
      isAvailable: async () => ({ ok: true }),
      costEstimate: async () => 0,
      generate: async () => ({ images: [core.images.save(PNG_1PX)], costUsd: 0 }),
      edit: async (req) => {
        edits.push(req);
        return { images: [core.images.save(PNG_1PX)], costUsd: 0 };
      },
    };
    const local = buildServer({ core, engines: registryWith(engine) });
    const sceneRef = core.images.save(Buffer.concat([PNG_1PX, Buffer.from([7])]));
    const plate = core.images.save(Buffer.concat([PNG_1PX, Buffer.from([8])]));
    const castShot = core.images.save(Buffer.concat([PNG_1PX, Buffer.from([9])]));
    const brand = (
      await local.inject({
        method: 'POST',
        url: '/api/brands',
        payload: {
          brand: {
            specVersion: '0.1',
            meta: { name: 'Acme' },
            characters: [{ id: 'c1', name: 'Astrid', shots: [{ file: `asset:${castShot}`, locked: true }] }],
            scenes: [
              {
                id: 'portrait-world',
                name: 'Portrait World',
                lighting: 'Hard side key',
                description: 'A close portrait world.',
                subject: 'person',
                prompt: 'A close portrait against deep charcoal.',
                width: 1024,
                height: 1280,
                figure: 'one figure at close range',
                refs: [{ file: `asset:${sceneRef}` }],
                preview: `asset:${plate}`,
              },
            ],
          },
        },
      })
    ).json();
    const ws = await local.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    const projectId = ws.json().project.id;

    const gen = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        kind: 'generation',
        engineId: 'scene-spy',
        brief: {
          tokens: [
            { t: 'format', id: 'square', w: 512, h: 512 },
            { t: 'character', id: 'c1' },
            { t: 'template', id: 'portrait-world' },
          ],
        },
      },
    });
    expect(gen.statusCode).toBe(202);
    const genNode = await waitDoneOn(local, gen.json().id);
    expect(genNode.status).toBe('done');

    const edit = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'scene-spy',
        sourceImage: genNode.images[0],
        brief: { tokens: [{ t: 'text', v: 'a more editorial and cinematic feel' }] },
      },
    });
    const editNode = await waitDoneOn(local, edit.json().id);
    expect(editNode.status).toBe('done');

    const req = edits[0];
    expect(req.referenceRoles ?? []).not.toContain('scene');
    expect(req.referenceImages ?? []).not.toContain(core.images.pathFor(plate));
    expect(req.referenceImages ?? []).not.toContain(core.images.pathFor(sceneRef));
    // the presenter's identity still rides
    expect(req.referenceImages ?? []).toContain(core.images.pathFor(castShot));
    await local.close();
  });
});

// A shape is only an ask when the brief carries one. A formatless edit brief
// compiles at the default canvas, and the implicit-reshape gate used to read
// that default as "reshape to square" - an API caller's plain refine became
// an expansion with invented margins.
describe('a formatless edit brief never reshapes', () => {
  it('a plain refine of a portrait stays a portrait', async () => {
    const edits: EditRequest[] = [];
    const png = (w: number, h: number) =>
      sharp({ create: { width: w, height: h, channels: 3, background: '#335544' } })
        .png()
        .toBuffer();
    const engine: EngineAdapter = {
      capabilities: () => ({
        id: 'shape-spy',
        displayName: 'Shape Spy',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        maxReferenceImages: 4,
      }),
      isAvailable: async () => ({ ok: true }),
      costEstimate: async () => 0,
      generate: async () => ({ images: [core.images.save(await png(800, 1000))], costUsd: 0 }),
      // the spy answers at whatever size it was asked for
      edit: async (req) => {
        edits.push(req);
        return { images: [core.images.save(await png(req.width ?? 800, req.height ?? 1000))], costUsd: 0 };
      },
    };
    const local = buildServer({ core, engines: registryWith(engine) });
    const brand = (
      await local.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' } } },
      })
    ).json();
    const ws = await local.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    const projectId = ws.json().project.id;
    const gen = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        kind: 'generation',
        engineId: 'shape-spy',
        brief: {
          tokens: [
            { t: 'format', id: 'portrait', w: 800, h: 1000 },
            { t: 'text', v: 'a mug' },
          ],
        },
      },
    });
    const genNode = await waitDoneOn(local, gen.json().id);

    const edit = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'shape-spy',
        sourceImage: genNode.images[0],
        // no format token: the shape is not an ask, the source's shape holds
        brief: { tokens: [{ t: 'text', v: 'warmer light' }] },
      },
    });
    const editNode = await waitRenderedOn(local, edit.json().id);
    expect(editNode.status).toBe('done');
    // the engine was asked for the source's own pixels, not a square plan
    expect([edits[0].width, edits[0].height]).toEqual([800, 1000]);
    expect(edits[0].expand).toBeUndefined();
    expect((editNode.brief as any).expand).toBeUndefined();
    expect((editNode.brief as any).rendered?.sizes?.[0]).toEqual([800, 1000]);
    await local.close();
  });
});

// The waxy look compounds exactly where the skin floor never fired: a refine
// brief has no character token, so compileBrief's hasPerson gate stayed cold
// on every hop of a presenter thread. The inherited person now carries it.
describe('the skin floor rides refines of presenter threads', () => {
  it('a bare-text refine of a presenter shot states real photographed skin', async () => {
    const castShot = core.images.save(Buffer.concat([PNG_1PX, Buffer.from([11])]));
    const brand = (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: {
          brand: {
            specVersion: '0.1',
            meta: { name: 'Acme' },
            characters: [{ id: 'c1', name: 'Astrid', shots: [{ file: `asset:${castShot}`, locked: true }] }],
          },
        },
      })
    ).json();
    const ws = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    const projectId = ws.json().project.id;
    const gen = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        kind: 'generation',
        engineId: 'demo',
        brief: {
          tokens: [
            { t: 'format', id: 'square', w: 512, h: 512 },
            { t: 'character', id: 'c1' },
            { t: 'text', v: 'editorial portrait' },
          ],
        },
      },
    });
    const genNode = await waitDone(gen.json().id);
    const edit = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'demo',
        sourceImage: genNode.images[0],
        brief: { tokens: [{ t: 'text', v: 'warmer light' }] },
      },
    });
    const editNode = await waitDone(edit.json().id);
    expect(editNode.prompt).toContain('real photographed skin');
    // and the re-render texture floor rides every edit
    expect(editNode.prompt).toContain('Every surface keeps the texture it already has');
  });
});

// A pure-grade refinement ships the original's pixels wearing the model's
// grade: texture and resolution frozen, tone moved. The model's frame ships
// only when its answer was more than a grade, or the ask named a thing.
describe('grade-only refines keep the original pixels', () => {
  const gradeEngine = () => {
    const edits: EditRequest[] = [];
    const engine: EngineAdapter = {
      capabilities: () => ({
        id: 'grade-spy',
        displayName: 'Grade Spy',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        maxReferenceImages: 4,
      }),
      isAvailable: async () => ({ ok: true }),
      costEstimate: async () => 0,
      generate: async () => {
        // a textured card, not a flat colour: the grade fit needs tonal spread
        const w = 320;
        const h = 400;
        const raw = Buffer.alloc(w * h * 3);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 3;
            const g = Math.round((x / w) * 200) + ((x * 7 + y * 13) % 17);
            raw[i] = g;
            raw[i + 1] = g;
            raw[i + 2] = g;
          }
        return {
          images: [
            core.images.save(
              await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
                .png()
                .toBuffer(),
            ),
          ],
          costUsd: 0,
        };
      },
      // the model's answer: the source, warmed - a true grade
      edit: async (req) => {
        edits.push(req);
        const warmedBuf = await sharp(req.sourceImage).modulate({ brightness: 1.1 }).tint('#ffd9b0').png().toBuffer();
        return { images: [core.images.save(warmedBuf)], costUsd: 0 };
      },
    };
    return { engine, edits };
  };

  it('ships graded original pixels and records it; a thing-naming ask bypasses', async () => {
    const { engine } = gradeEngine();
    const local = buildServer({ core, engines: registryWith(engine) });
    const brand = (
      await local.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' } } },
      })
    ).json();
    const ws = await local.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    const projectId = ws.json().project.id;
    const gen = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        kind: 'generation',
        engineId: 'grade-spy',
        brief: {
          tokens: [
            { t: 'format', id: 'portrait', w: 320, h: 400 },
            { t: 'text', v: 'a mug' },
          ],
        },
      },
    });
    const genNode = await waitDoneOn(local, gen.json().id);
    const srcHash = genNode.images[0];

    const graded = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'grade-spy',
        sourceImage: srcHash,
        brief: {
          tokens: [
            { t: 'format', id: 'portrait', w: 320, h: 400 },
            { t: 'text', v: 'slightly warmer light' },
          ],
        },
      },
    });
    const gradedNode = await waitRenderedOn(local, graded.json().id);
    expect(gradedNode.status).toBe('done');
    expect((gradedNode.brief as any).gradeComposited).toBe(true);
    // warmer than the source: the grade landed on the original's own pixels
    const mean = async (h: string) => (await sharp(core.images.read(h)).stats()).channels.map((c) => c.mean);
    const [sr, , sb] = await mean(srcHash);
    const [gr, , gb] = await mean(gradedNode.images[0]);
    expect(gr - gb).toBeGreaterThan(sr - sb);

    const named = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'grade-spy',
        sourceImage: srcHash,
        brief: {
          tokens: [
            { t: 'format', id: 'portrait', w: 320, h: 400 },
            { t: 'text', v: 'remove the cup on the left' },
          ],
        },
      },
    });
    const namedNode = await waitRenderedOn(local, named.json().id);
    expect((namedNode.brief as any).gradeComposited).toBeUndefined();
    await local.close();
  });
});

// The reshape geometry contract, end to end on toy engines: the server
// classifies the op, an extend is planned at the engine's own pixel budget,
// and nothing on the path is ever upscaled. This is the pin on the 0.7.2
// ratio-refine hardening: the measured failure was a 1122x1402 shot asked for
// 16:9 planning a 2496x1402 frame, 2.2x what codex can draw, and the native
// answer upscaled 1.49x to fill it.
describe('a reshape is classified by the server and planned at the engine budget', () => {
  const budgetEngine = () => {
    const edits: EditRequest[] = [];
    const png = (w: number, h: number) =>
      sharp({ create: { width: w, height: h, channels: 3, background: '#557799' } })
        .png()
        .toBuffer();
    const engine: EngineAdapter = {
      capabilities: () => ({
        id: 'reshape-spy',
        displayName: 'Reshape Spy',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        maxReferenceImages: 4,
        editPixelBudget: 6400, // 80x80 - a toy codex
      }),
      isAvailable: async () => ({ ok: true }),
      costEstimate: async () => 0,
      generate: async (req) => ({ images: [core.images.save(await png(req.width, req.height))], costUsd: 0 }),
      // the edit honours the exact requested frame, like codex after the fit
      edit: async (req) => {
        edits.push(req);
        return { images: [core.images.save(await png(req.width ?? 64, req.height ?? 64))], costUsd: 0 };
      },
    };
    return { engine, edits };
  };

  const seedOn = async (local: Awaited<ReturnType<typeof buildServer>>, w: number, h: number, id = 'square') => {
    const brand = (
      await local.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' } } },
      })
    ).json();
    const ws = await local.inject({ method: 'GET', url: `/api/brands/${brand.id}/workspace` });
    const projectId = ws.json().project.id;
    const gen = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId,
        kind: 'generation',
        engineId: 'reshape-spy',
        brief: {
          tokens: [
            { t: 'format', id, w, h },
            { t: 'text', v: 'a mug' },
          ],
        },
      },
    });
    const genNode = await waitDoneOn(local, gen.json().id);
    return { projectId, genNode };
  };

  it('an over-budget extend is fitted, drawn native, and never upscaled', async () => {
    const { engine, edits } = budgetEngine();
    const local = buildServer({ core, engines: registryWith(engine) });
    try {
      const { projectId, genNode } = await seedOn(local, 100, 100);

      const edit = await local.inject({
        method: 'POST',
        url: '/api/nodes',
        payload: {
          projectId,
          parentId: genNode.id,
          kind: 'edit',
          engineId: 'reshape-spy',
          sourceImage: genNode.images[0],
          reshape: 'extend',
          brief: { tokens: [{ t: 'format', id: 'landscape', w: 176, h: 100 }] },
        },
      });
      expect(edit.statusCode).toBe(202);
      expect((edit.json().warnings ?? []).join(' ')).toContain('Nothing is upscaled');

      const editNode = await waitRenderedOn(local, edit.json().id);
      expect(editNode.status).toBe('done');

      // both draws (bed and padded) were asked inside the budget
      expect(edits.length).toBe(2);
      for (const req of edits) {
        expect((req.width ?? 0) * (req.height ?? 0)).toBeLessThanOrEqual(6400 * 1.02);
        // and the conditioning canvas they were shown is at that same frame
        const sent = await sharp(req.sourceImage).metadata();
        expect([sent.width, sent.height]).toEqual([req.width, req.height]);
      }

      // the stored answer is the fitted frame itself: no upscale anywhere
      const stored = await sharp(core.images.read(editNode.images[0])).metadata();
      expect([stored.width, stored.height]).toEqual([edits[0].width, edits[0].height]);
      const brief = editNode.brief as any;
      expect(brief.reshape).toBe('extend');
      expect(brief.expand.frame).toEqual([edits[0].width, edits[0].height]);
      // the photograph rides inside the frame at its fitted size, ratio kept
      const [sw, sh] = brief.expand.source;
      expect(sw * sh).toBeLessThan(6400);
      expect(Math.abs(sw / sh - 1)).toBeLessThan(0.05);
      expect(brief.rendered?.requestedSize).toEqual([edits[0].width, edits[0].height]);

      // an explicit extend carries the extend preservation language
      expect(edits[0].instruction).toContain('does not restage it');

      // the next refine reads the extended image at its true size: no
      // step-down, no warning, no size laundering on the following hop
      const again = await local.inject({
        method: 'POST',
        url: '/api/nodes',
        payload: {
          projectId,
          parentId: editNode.id,
          kind: 'edit',
          engineId: 'reshape-spy',
          sourceImage: editNode.images[0],
          brief: { tokens: [{ t: 'text', v: 'a more editorial and cinematic feel' }] },
        },
      });
      expect((again.json().warnings ?? []).join(' ')).not.toContain('continues');
      const againNode = await waitRenderedOn(local, again.json().id);
      expect([edits[2].width, edits[2].height]).toEqual([edits[0].width, edits[0].height]);
      const storedAgain = await sharp(core.images.read(againNode.images[0])).metadata();
      expect([storedAgain.width, storedAgain.height]).toEqual([edits[0].width, edits[0].height]);
    } finally {
      await local.close();
    }
  });

  it('growth past the bound becomes a crop when nothing was asked by name, and refuses an explicit extend', async () => {
    const { engine, edits } = budgetEngine();
    const local = buildServer({ core, engines: registryWith(engine) });
    try {
      const { projectId, genNode } = await seedOn(local, 176, 100, 'landscape');

      // implicit: a 16:9 shot asked for 9:16 is a 3.16x growth, past the
      // bound even after crop assist; the honest op is a crop and it is free
      const implicit = await local.inject({
        method: 'POST',
        url: '/api/nodes',
        payload: {
          projectId,
          parentId: genNode.id,
          kind: 'edit',
          engineId: 'reshape-spy',
          sourceImage: genNode.images[0],
          brief: { tokens: [{ t: 'format', id: 'story', w: 90, h: 160 }] },
        },
      });
      expect(implicit.statusCode).toBe(202);
      expect((implicit.json().warnings ?? []).join(' ')).toContain('cropped to it instead');
      const cropNode = await waitDoneOn(local, implicit.json().id);
      expect(cropNode.engineId).toBe('local');
      expect((cropNode.brief as any).reshape).toBe('crop');
      const stored = await sharp(core.images.read(cropNode.images[0])).metadata();
      expect(Math.abs(stored.width! / stored.height! - 90 / 160)).toBeLessThan(0.02);
      expect(edits.length).toBe(0); // no engine was asked

      // explicit: the same geometry asked for by name is refused out loud
      const explicit = await local.inject({
        method: 'POST',
        url: '/api/nodes',
        payload: {
          projectId,
          parentId: genNode.id,
          kind: 'edit',
          engineId: 'reshape-spy',
          sourceImage: genNode.images[0],
          reshape: 'extend',
          brief: { tokens: [{ t: 'format', id: 'story', w: 90, h: 160 }] },
        },
      });
      expect(explicit.statusCode).toBe(400);
      expect(explicit.json().error).toMatch(/crop instead/);
    } finally {
      await local.close();
    }
  });

  it('growth just past the assist threshold gives up a capped slice and records it', async () => {
    const { engine, edits } = budgetEngine();
    const local = buildServer({ core, engines: registryWith(engine) });
    try {
      const { projectId, genNode } = await seedOn(local, 100, 125, 'portrait');

      // 4:5 to 16:9 is a 2.22x growth: crop assist takes about ten percent of
      // the height so the effective growth lands on the bound, and the extend
      // proceeds inside it
      const edit = await local.inject({
        method: 'POST',
        url: '/api/nodes',
        payload: {
          projectId,
          parentId: genNode.id,
          kind: 'edit',
          engineId: 'reshape-spy',
          sourceImage: genNode.images[0],
          reshape: 'extend',
          brief: { tokens: [{ t: 'format', id: 'landscape', w: 176, h: 99 }] },
        },
      });
      expect(edit.statusCode).toBe(202);
      const editNode = await waitRenderedOn(local, edit.json().id);
      expect(editNode.status).toBe('done');
      const brief = editNode.brief as any;
      // the assist window: full width, about ninety percent of the height
      expect(brief.expand.assist[0]).toBe(100);
      expect(brief.expand.assist[1]).toBeGreaterThanOrEqual(110);
      expect(brief.expand.assist[1]).toBeLessThan(125);
      // and the request still fits the budget
      expect((edits[0].width ?? 0) * (edits[0].height ?? 0)).toBeLessThanOrEqual(6400 * 1.02);
    } finally {
      await local.close();
    }
  });
});

/**
 * A four-shot request is four sibling nodes sharing one engine call. The call
 * used to be the unit of completion: no sibling left `running` until the
 * slowest one had landed, so three finished pictures sat invisible behind one
 * slow exec. Each slot now settles the moment its own image exists.
 */
describe('progressive delivery', () => {
  const png = (seed: number) =>
    sharp({ create: { width: 64, height: 64, channels: 3, background: { r: seed % 256, g: 20, b: 30 } } })
      .png()
      .toBuffer();

  /**
   * An adapter the test drives by hand. `report(slot, hash)` hands the server
   * one finished image through the contract's onImage channel; `finish()`
   * resolves the call the way every adapter does at the end, listing what
   * landed in slot order; a user abort rejects it and a budget abort answers
   * with whatever landed, exactly as codex does.
   */
  const staged = (costUsd = 0.4) => {
    const landed = new Map<number, string>();
    let onImage: ((slot: number, hash: string) => void) | undefined;
    let resolveCall: ((r: { images: string[]; costUsd: number; raw?: unknown }) => void) | null = null;
    let rejectCall: ((e: unknown) => void) | null = null;
    const answer = (extra: Record<string, unknown> = {}) => {
      const slots = [...landed.keys()].sort((a, b) => a - b);
      return { images: slots.map((s) => landed.get(s)!), costUsd, raw: { variantIndexes: slots, ...extra } };
    };
    const adapter: EngineAdapter = {
      capabilities: () => ({
        id: 'staged',
        displayName: 'Staged',
        localOnly: true,
        supportsEdit: true,
        supportsMask: false,
        maxReferenceImages: 0,
      }),
      isAvailable: async () => ({ ok: true }),
      costEstimate: async () => costUsd,
      generate: (_req, signal, report) => {
        onImage = report;
        return new Promise((res, rej) => {
          resolveCall = res;
          rejectCall = rej;
          signal?.addEventListener(
            'abort',
            () => (signal.reason === BUDGET_EXHAUSTED ? res(answer()) : rej(new Error('aborted'))),
            { once: true },
          );
        });
      },
      edit: async () => ({ images: [core.images.save(await png(7))], costUsd: 0 }),
    };
    /** A distinct finished image for this slot, saved the way an engine saves it. */
    const prepare = async (slot: number) => core.images.save(await png(40 + slot * 30));
    const report = (slot: number, hash: string) => {
      landed.set(slot, hash);
      onImage?.(slot, hash);
    };
    const land = async (slot: number) => {
      const hash = await prepare(slot);
      report(slot, hash);
      return hash;
    };
    return {
      adapter,
      prepare,
      report,
      land,
      finish: (extra?: Record<string, unknown>) => resolveCall?.(answer(extra)),
      fail: (err: unknown) => rejectCall?.(err),
    };
  };

  const boot = async (s: ReturnType<typeof staged>, count: number, nodeTimeoutMs?: number) => {
    const local = buildServer({
      core,
      engines: registryWith(s.adapter),
      ...(nodeTimeoutMs ? { nodeTimeoutMs } : {}),
    });
    const b = await local.inject({
      method: 'POST',
      url: '/api/brands',
      payload: { brand: { specVersion: '0.1', meta: { name: 'W' }, palette: { primary: { hex: '#123456' } } } },
    });
    const proj = await local.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { brandId: b.json().id, name: 'w' },
    });
    const gen = await local.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: proj.json().project.id,
        parentId: proj.json().root.id,
        kind: 'generation',
        prompt: 'x',
        engineId: 'staged',
        count,
        width: 64,
        height: 64,
      },
    });
    expect(gen.statusCode).toBe(202);
    const siblings = gen.json().siblings as { id: string; batchIndex: number; createdAt: string }[];
    return {
      local,
      brandId: b.json().id as string,
      projectId: proj.json().project.id as string,
      siblings,
    };
  };
  const status = async (local: FastifyInstance, id: string) =>
    (await local.inject({ method: 'GET', url: `/api/nodes/${id}` })).json();
  /** The run's money is written last, so a charged first sibling means the run has fully wound down. */
  const waitCharged = async (local: FastifyInstance, id: string) => {
    for (let i = 0; i < 200; i++) {
      const n = await status(local, id);
      if (n.costUsd > 0) return n;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('the run never charged its first sibling');
  };

  it('a slot that lands is done while its siblings are still running', async () => {
    const s = staged();
    const { local, brandId, siblings } = await boot(s, 4);
    try {
      const hash = await s.land(2);
      const third = await waitDoneOn(local, siblings[2].id);
      expect(third.status).toBe('done');
      expect(third.images).toEqual([hash]);
      expect(third.durationMs).toBeGreaterThan(0);
      expect((await waitRenderedOn(local, siblings[2].id)).brief.rendered.sizes).toEqual([[64, 64]]);
      for (const i of [0, 1, 3]) expect((await status(local, siblings[i].id)).status).toBe('running');
      // the bell's one question answers the same way
      const activity = await local.inject({ method: 'GET', url: `/api/brands/${brandId}/activity` });
      const byId = new Map<string, string>(activity.json().nodes.map((n: any) => [n.id, n.status]));
      expect(byId.get(siblings[2].id)).toBe('done');
      expect(byId.get(siblings[0].id)).toBe('running');
      for (const i of [0, 1, 3]) await s.land(i);
      s.finish();
      for (const n of siblings) expect((await waitDoneOn(local, n.id)).status).toBe('done');
      await waitCharged(local, siblings[0].id);
    } finally {
      await local.close();
    }
  });

  it('a single shot lands the same way', async () => {
    const s = staged();
    const { local, siblings } = await boot(s, 1);
    try {
      const hash = await s.land(0);
      expect(await waitDoneOn(local, siblings[0].id)).toMatchObject({ status: 'done', images: [hash] });
      s.finish();
      await waitCharged(local, siblings[0].id);
    } finally {
      await local.close();
    }
  });

  it('landing out of order leaves the request order untouched', async () => {
    const s = staged();
    const { local, projectId, siblings } = await boot(s, 4);
    try {
      for (const slot of [3, 1, 0, 2]) {
        await s.land(slot);
        await waitDoneOn(local, siblings[slot].id);
      }
      s.finish();
      await waitCharged(local, siblings[0].id);
      const tree = (await local.inject({ method: 'GET', url: `/api/projects/${projectId}/tree` })).json()
        .nodes as any[];
      const batch = tree.filter((n) => n.kind === 'generation');
      // slot 0 newest, so newest-first reads 0,1,2,3 whatever order they landed in
      const byNewest = [...batch].sort(
        (a, b) => (b.createdAt as string).localeCompare(a.createdAt) || (b.id as string).localeCompare(a.id),
      );
      expect(byNewest.map((n) => n.batchIndex)).toEqual([0, 1, 2, 3]);
      expect(byNewest.map((n) => n.id)).toEqual(siblings.map((n) => n.id));
      expect(new Set(batch.map((n) => n.images[0])).size).toBe(4);
      // one compile, shared: every sibling carries the same prompt and recipe
      expect(new Set(batch.map((n) => n.prompt)).size).toBe(1);
    } finally {
      await local.close();
    }
  });

  it('two slots landing in the same tick both land', async () => {
    const s = staged();
    const { local, siblings } = await boot(s, 2);
    try {
      const [h0, h1] = await Promise.all([s.prepare(0), s.prepare(1)]);
      s.report(0, h0);
      s.report(1, h1);
      expect((await waitDoneOn(local, siblings[0].id)).images).toEqual([h0]);
      expect((await waitDoneOn(local, siblings[1].id)).images).toEqual([h1]);
      s.finish();
      await waitCharged(local, siblings[0].id);
    } finally {
      await local.close();
    }
  });

  it('a slot that fails fails alone', async () => {
    const s = staged();
    const { local, siblings } = await boot(s, 4);
    try {
      for (const slot of [0, 2, 3]) await s.land(slot);
      s.finish({ partialFailures: ['slot one refused'] });
      expect(await waitDoneOn(local, siblings[1].id)).toMatchObject({ status: 'error', error: 'slot one refused' });
      for (const i of [0, 2, 3]) expect((await waitDoneOn(local, siblings[i].id)).status).toBe('done');
      await waitCharged(local, siblings[0].id);
    } finally {
      await local.close();
    }
  });

  it('cancelling after two shots landed keeps the two and stops the rest', async () => {
    const s = staged();
    const { local, siblings } = await boot(s, 4);
    try {
      const h0 = await s.land(0);
      const h1 = await s.land(1);
      await waitDoneOn(local, siblings[0].id);
      await waitDoneOn(local, siblings[1].id);
      const cancel = await local.inject({ method: 'POST', url: `/api/nodes/${siblings[3].id}/cancel` });
      expect(cancel.statusCode).toBe(200);
      expect((await waitDoneOn(local, siblings[2].id)).status).toBe('cancelled');
      expect((await waitDoneOn(local, siblings[3].id)).status).toBe('cancelled');
      expect(await status(local, siblings[0].id)).toMatchObject({ status: 'done', images: [h0] });
      expect(await status(local, siblings[1].id)).toMatchObject({ status: 'done', images: [h1] });
      // the call is over: nothing left to cancel
      const again = await local.inject({ method: 'POST', url: `/api/nodes/${siblings[0].id}/cancel` });
      expect(again.statusCode).toBe(400);
    } finally {
      await local.close();
    }
  });

  it('a landed shot can be refined while its siblings are still coming', async () => {
    const s = staged();
    const { local, projectId, siblings } = await boot(s, 3);
    try {
      await s.land(1);
      await waitDoneOn(local, siblings[1].id);
      const edit = await local.inject({
        method: 'POST',
        url: '/api/nodes',
        payload: { projectId, parentId: siblings[1].id, kind: 'edit', prompt: 'warmer', engineId: 'staged' },
      });
      expect(edit.statusCode).toBe(202);
      const child = await waitDoneOn(local, edit.json().id);
      expect(child.status).toBe('done');
      expect(child.parentId).toBe(siblings[1].id);
      expect((await status(local, siblings[0].id)).status).toBe('running');
      await s.land(0);
      await s.land(2);
      s.finish();
      for (const n of siblings) expect((await waitDoneOn(local, n.id)).status).toBe('done');
      await waitCharged(local, siblings[0].id);
    } finally {
      await local.close();
    }
  });

  it('the money lands on the first sibling however late it lands', async () => {
    const s = staged(0.4);
    const { local, siblings } = await boot(s, 2);
    try {
      await s.land(1);
      await waitDoneOn(local, siblings[1].id);
      await s.land(0);
      await waitDoneOn(local, siblings[0].id);
      s.finish();
      expect((await waitCharged(local, siblings[0].id)).costUsd).toBeCloseTo(0.4);
      expect((await status(local, siblings[1].id)).costUsd).toBe(0);
    } finally {
      await local.close();
    }
  });

  it('a run that outlives the watchdog keeps the shots that landed', async () => {
    const s = staged();
    const { local, siblings } = await boot(s, 3, 300);
    try {
      const h0 = await s.land(0);
      await waitDoneOn(local, siblings[0].id);
      // never finished by hand: the budget abort makes the adapter answer with what it has
      expect((await waitDoneOn(local, siblings[1].id)).status).toBe('error');
      expect((await waitDoneOn(local, siblings[2].id)).status).toBe('error');
      expect(await status(local, siblings[0].id)).toMatchObject({ status: 'done', images: [h0] });
      await waitCharged(local, siblings[0].id);
    } finally {
      await local.close();
    }
  });

  it('another brand never sees the batch, landed or not', async () => {
    const s = staged();
    const { local, siblings } = await boot(s, 2);
    try {
      const other = await local.inject({
        method: 'POST',
        url: '/api/brands',
        payload: {
          brand: { specVersion: '0.1', meta: { name: 'Elsewhere' }, palette: { primary: { hex: '#654321' } } },
        },
      });
      await s.land(0);
      await waitDoneOn(local, siblings[0].id);
      const ids = new Set(siblings.map((n) => n.id));
      const activity = (await local.inject({ method: 'GET', url: `/api/brands/${other.json().id}/activity` })).json();
      expect(activity.nodes.some((n: any) => ids.has(n.id))).toBe(false);
      const ws = (await local.inject({ method: 'GET', url: `/api/brands/${other.json().id}/feed?limit=200` })).json();
      expect(ws.items.some((n: any) => ids.has(n.id))).toBe(false);
      await s.land(1);
      s.finish();
      await waitCharged(local, siblings[0].id);
    } finally {
      await local.close();
    }
  });
});
