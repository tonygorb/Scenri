import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core } from '@scenri/core';
import { createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';
import { drainTracked, track } from './servers.js';

/**
 * Pictures nothing names used to stay on disk for good: a scene studio's
 * unused versions (its jobs live in memory), an upload never filed, a likeness
 * photo taken off before Continue (SOAK-2). Boot lets the old ones go.
 */

let home: string;
let core: Core;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-sweep-'));
  core = createCore(home);
});
afterEach(async () => {
  vi.restoreAllMocks();
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
      phone: { addresses: async () => [], listen: async () => ({ close: async () => undefined }) },
    }),
  );
};

/** The sweep is queued behind boot; a turn of the loop later it has run. */
const afterBoot = () => new Promise((r) => setImmediate(r));

const aged = (hash: string, days: number) => {
  const at = new Date(Date.now() - days * DAY);
  utimesSync(core.images.pathFor(hash), at, at);
  return hash;
};

describe('the boot sweep of unreferenced pictures', () => {
  it('removes old pictures nothing names, with their thumbnails, and keeps every other', async () => {
    const byBrand = aged(core.images.save(Buffer.from('a presenter view')), 90);
    const brand = core.store.createBrand({
      specVersion: '0.1',
      meta: { name: 'Acme' },
      characters: [{ id: 'up-a', name: 'Ria', origin: 'custom', shots: [{ file: `asset:${byBrand}` }] }],
    } as any);
    const byShot = aged(core.images.save(Buffer.from('a finished shot')), 90);
    const node = core.store.addNode({
      projectId: core.store.workspaceFor(brand.id).id,
      parentId: null,
      kind: 'generation',
      prompt: 'x',
      engineId: 'demo',
    });
    core.store.completeNode(node.id, { images: [byShot], costUsd: 0 });
    const orphan = aged(core.images.save(Buffer.from('an upload nobody filed')), 90);
    // Inside the window: a brief left half written in the Composer keeps its
    // uploads for a month after its last edit.
    const recent = aged(core.images.save(Buffer.from('an upload a kept draft still shows')), 45);
    const fresh = core.images.save(Buffer.from('an upload from a minute ago'));
    const thumb = join(home, 'thumbs', `${orphan}-w320.webp`);
    mkdirSync(join(home, 'thumbs'), { recursive: true });
    writeFileSync(thumb, 'webp');

    serve();
    await afterBoot();

    expect(core.images.has(orphan)).toBe(false);
    expect(existsSync(thumb)).toBe(false);
    expect(core.images.has(byBrand)).toBe(true);
    expect(core.images.has(byShot)).toBe(true);
    expect(core.images.has(recent)).toBe(true);
    expect(core.images.has(fresh)).toBe(true);
  });

  it('removes nothing when a reference source could not be read', async () => {
    const orphan = aged(core.images.save(Buffer.from('an upload nobody filed')), 90);
    vi.spyOn(core.store, 'referencedHashes').mockImplementation(() => {
      throw new Error('database is locked');
    });

    serve();
    await afterBoot();

    expect(core.images.has(orphan)).toBe(true);
  });
});
