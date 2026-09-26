import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core } from '@scenri/core';
import { createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';
import { drainTracked, track } from './servers.js';

/**
 * Deleting a presenter is deleting the person (SEC1-H1i). An edit that
 * changed a picture wrote a new record and kept the old one, superseded, with
 * the same person's photographs; deleting the head used to leave every one of
 * those on disk, hidden from every list.
 */

let home: string;
let core: Core;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-pchain-'));
  core = createCore(home);
});
afterEach(async () => {
  await drainTracked();
  try {
    core.close();
  } catch {
    // A drained server closes the core on its way out; closing twice throws.
  }
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const serve = () => {
  const demo = createDemoEngine((b) => core.images.save(b));
  return track(
    buildServer({
      core,
      engines: { all: () => [demo], get: (id) => (id === demo.capabilities().id ? demo : null) },
      // nothing reads a photograph here, and no codex is spawned to find that out
      analyzer: { isAvailable: async () => ({ ok: false, reason: 'none in a unit test' }) } as any,
      phone: { addresses: async () => [], listen: async () => ({ close: async () => undefined }) },
    }),
  );
};

describe('DELETE /api/brands/:id/presenters/:presenterId', () => {
  const pic = (label: string) => core.images.save(Buffer.from(label));
  const status = async (app: ReturnType<typeof serve>, hash: string) =>
    (await app.inject({ method: 'GET', url: `/api/images/${hash}` })).statusCode;
  const stored = (brandId: string): string[] =>
    ((core.store.getBrand(brandId)?.json as any)?.characters ?? []).map((c: any) => c.id);

  it('takes every revision the head superseded, and the pictures only they held', async () => {
    const firstView = pic('the portrait the person was first cast with');
    const redrawn = pic('the portrait an edit redrew');
    const shared = pic('a picture another presenter uses too');
    const brand = core.store.createBrand({
      specVersion: '0.1',
      meta: { name: 'Acme' },
      characters: [
        {
          id: 'up-old',
          name: 'Ria',
          origin: 'custom',
          supersededBy: 'up-new',
          shots: [{ file: `asset:${firstView}` }, { file: `asset:${shared}` }],
        },
        { id: 'up-new', name: 'Ria', origin: 'custom', revisionOf: 'up-old', shots: [{ file: `asset:${redrawn}` }] },
        { id: 'up-other', name: 'Ines', origin: 'custom', shots: [{ file: `asset:${shared}` }] },
      ],
    } as any);
    const app = serve();

    const res = await app.inject({ method: 'DELETE', url: `/api/brands/${brand.id}/presenters/up-new` });
    expect(res.statusCode).toBe(200);
    expect(res.json().brand.json.characters.map((c: any) => c.id)).toEqual(['up-other']);
    expect(stored(brand.id)).toEqual(['up-other']);
    expect(await status(app, redrawn)).toBe(404);
    expect(await status(app, firstView)).toBe(404);
    // another person still wears it
    expect(await status(app, shared)).toBe(200);
  });

  it('takes the photographs the person was made from, not only the views drawn from them', async () => {
    const photo = pic('a photograph of a real person');
    const view = pic('a view drawn from it');
    const brand = core.store.createBrand({
      specVersion: '0.1',
      meta: { name: 'Acme' },
      characters: [
        {
          id: 'up-old',
          name: 'Ria',
          origin: 'custom',
          source: 'photos',
          supersededBy: 'up-new',
          shots: [{ file: `asset:${view}` }],
          sourceRefs: [{ file: `asset:${photo}` }],
        },
        {
          id: 'up-new',
          name: 'Ria',
          origin: 'custom',
          source: 'photos',
          revisionOf: 'up-old',
          shots: [{ file: `asset:${view}` }],
          sourceRefs: [{ file: `asset:${photo}` }],
        },
      ],
    } as any);
    const app = serve();

    expect((await app.inject({ method: 'DELETE', url: `/api/brands/${brand.id}/presenters/up-new` })).statusCode).toBe(
      200,
    );
    expect(await status(app, view)).toBe(404);
    expect(await status(app, photo)).toBe(404);
  });

  it('deleting a head that was never revised still leaves the others alone', async () => {
    const mine = pic('only this person');
    const theirs = pic('someone else');
    const brand = core.store.createBrand({
      specVersion: '0.1',
      meta: { name: 'Acme' },
      characters: [
        { id: 'up-a', name: 'Ria', origin: 'custom', shots: [{ file: `asset:${mine}` }] },
        { id: 'up-b-old', name: 'Ines', origin: 'custom', supersededBy: 'up-b', shots: [{ file: `asset:${theirs}` }] },
        { id: 'up-b', name: 'Ines', origin: 'custom', revisionOf: 'up-b-old', shots: [{ file: `asset:${theirs}` }] },
      ],
    } as any);
    const app = serve();

    expect((await app.inject({ method: 'DELETE', url: `/api/brands/${brand.id}/presenters/up-a` })).statusCode).toBe(
      200,
    );
    expect(stored(brand.id)).toEqual(['up-b-old', 'up-b']);
    expect(await status(app, mine)).toBe(404);
    expect(await status(app, theirs)).toBe(200);
  });
});
