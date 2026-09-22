import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { createDemoAnalyzer, createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';
import { waitDone } from './helpers.js';
import { drainTracked, track } from './servers.js';

let home: string;
let core: Core;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-scale-server-'));
  core = createCore(home);
});
afterEach(async () => {
  await drainTracked();
  try {
    core.close();
  } catch {
    // a drained server closes the core on its way out
  }
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const png = (shade: number) =>
  sharp({ create: { width: 64, height: 80, channels: 3, background: { r: shade, g: shade, b: shade } } })
    .png()
    .toBuffer();

/**
 * The demo engine, with every call it is asked to make written down. It reads
 * images here: an engine that reads none cannot be handed the place's picture
 * or the product's, and draws the ordinary way.
 */
function spied() {
  const demo = createDemoEngine((b: Buffer) => core.images.save(b), { maxReferenceImages: 4 });
  const calls = { generate: [] as any[], edit: [] as any[] };
  const engine: EngineAdapter = {
    ...demo,
    capabilities: () => demo.capabilities(),
    costEstimate: (r) => demo.costEstimate(r),
    generate: (req, signal, onImage) => {
      calls.generate.push(req);
      return demo.generate(req, signal, onImage);
    },
    edit: (req, signal) => {
      calls.edit.push(req);
      return demo.edit(req, signal);
    },
  };
  return { engine, calls };
}

async function setup(reader: ReturnType<typeof createDemoAnalyzer> | null = createDemoAnalyzer()) {
  const { engine, calls } = spied();
  const app = track(
    buildServer({
      core,
      engines: { all: () => [engine], get: (id: string) => (id === 'demo' ? engine : null) },
      sizeReader: reader,
    }),
  );
  const product = core.images.save(await png(40));
  const plate = core.images.save(await png(160));
  const brand = (
    await app.inject({
      method: 'POST',
      url: '/api/brands',
      payload: {
        brand: {
          specVersion: '0.1',
          meta: { name: 'Acme' },
          products: [{ id: 'p1', name: 'House Blend', shots: [{ file: `asset:${product}`, locked: true }] }],
          scenes: [
            {
              id: 'us-steps',
              name: 'Concrete Steps',
              lighting: 'One hard raking side light',
              description: 'A brutalist hall.',
              subject: 'either',
              prompt: 'A minimal brutalist interior of raw board-formed concrete.',
              width: 1024,
              height: 1280,
              preview: `asset:${plate}`,
            },
          ],
        },
      },
    })
  ).json();
  const project = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { brandId: brand.id, name: 'p' } })
  ).json().project;
  const shoot = async (tokens: unknown[]) => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { projectId: project.id, kind: 'generation', engineId: 'demo', count: 1, brief: { tokens } },
    });
    expect(created.statusCode).toBe(202);
    return waitDone(app, created.json().id);
  };
  return { app, calls, brandId: brand.id as string, plate, shoot };
}

const alone = [
  { t: 'product', id: 'p1' },
  { t: 'text', v: ' on the steps' },
  { t: 'template', id: 'us-steps' },
];

describe('a small product alone in a place is drawn at its own scale', () => {
  it('reads its size once, draws the place at that magnification, then places the product', async () => {
    const { app, calls, brandId, plate, shoot } = await setup();
    const node = await shoot(alone);
    expect(node.status).toBe('done');
    expect(node.images).toHaveLength(1);

    // one plate, with the place's own picture as its world
    expect(calls.generate).toHaveLength(1);
    expect(calls.generate[0].prompt).toContain('spans only about 40 centimetres');
    expect(calls.generate[0].prompt).not.toContain('House Blend');
    expect(calls.generate[0].referenceRoles).toEqual(['scene']);
    expect(calls.generate[0].referenceImages).toEqual([core.images.pathFor(plate)]);
    // one placement on it, with the product's own photo
    expect(calls.edit).toHaveLength(1);
    expect(calls.edit[0].instruction).toContain('Place House Blend on that surface');
    expect(calls.edit[0].instruction).toContain("about 10 cm tall: about a quarter of the frame's width");
    expect(calls.edit[0].referenceRoles).toEqual(['product']);

    // the read was kept, and the page shows it
    const size = await app.inject({ method: 'GET', url: `/api/brands/${brandId}/products/p1/size` });
    expect(size.json().size).toEqual({ text: 'about 10 cm tall', largestCm: 10, by: 'estimate' });
    // and every compile now says how large it is
    const preview = await app.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: { brief: { tokens: alone }, engineId: 'demo', brandId },
    });
    expect(preview.json().prompt).toContain('Its real-world size is about 10 cm tall');
  });

  it("a person's correction on the page is what the next shot draws by", async () => {
    const { app, calls, brandId, shoot } = await setup();
    const bad = await app.inject({
      method: 'PUT',
      url: `/api/brands/${brandId}/products/p1/size`,
      payload: { size: 'large' },
    });
    expect(bad.statusCode).toBe(400);

    const big = await app.inject({
      method: 'PUT',
      url: `/api/brands/${brandId}/products/p1/size`,
      payload: { size: '60 x 40 cm' },
    });
    expect(big.json().size).toEqual({ text: '60 x 40 cm', largestCm: 60, by: 'person' });
    // too large for its own magnification: the ordinary draw, one generation
    await shoot(alone);
    expect(calls.edit).toHaveLength(0);
    expect(calls.generate).toHaveLength(1);
    expect(calls.generate[0].prompt).toContain('House Blend');

    // taking the correction back falls through to the read again
    const back = await app.inject({
      method: 'PUT',
      url: `/api/brands/${brandId}/products/p1/size`,
      payload: { size: '' },
    });
    expect(back.json().size).toEqual({ text: 'about 10 cm tall', largestCm: 10, by: 'estimate' });
  });

  it('with nothing to read a size, and nobody having said one, the shot is drawn the ordinary way', async () => {
    const { app, calls, brandId, shoot } = await setup(null);
    await shoot(alone);
    expect(calls.edit).toHaveLength(0);
    expect(calls.generate).toHaveLength(1);
    const size = await app.inject({ method: 'GET', url: `/api/brands/${brandId}/products/p1/size` });
    expect(size.json().size).toBeNull();
  });

  it("a product in a presenter's hands is drawn the ordinary way", async () => {
    const { calls, shoot } = await setup();
    await shoot([...alone, { t: 'text', v: ' held in her hand' }]);
    expect(calls.edit).toHaveLength(0);
    expect(calls.generate).toHaveLength(1);
  });

  it('an unknown product has no size to show', async () => {
    const { app, brandId } = await setup();
    const res = await app.inject({ method: 'GET', url: `/api/brands/${brandId}/products/nope/size` });
    expect(res.statusCode).toBe(404);
  });
});
