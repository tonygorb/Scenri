import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core } from '@scenri/core';
import { presenterCropMode, repairPresenterCrops } from '../src/presenterRepair.js';
import { presenterCrops } from '../src/customAssets.js';

let home: string;
let core: Core;

const png = (tint: string) =>
  sharp({ create: { width: 64, height: 80, channels: 3, background: tint } })
    .png()
    .toBuffer();

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-repair-'));
  core = createCore(home);
});
afterEach(() => {
  core.close();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const seedBrand = (characters: unknown[]) =>
  core.store.createBrand({ specVersion: '0.1', meta: { name: 'Acme' }, characters } as any);

const charOf = (brandId: string) => (core.store.getBrand(brandId)!.json as any).characters[0];

describe('presenterCropMode', () => {
  it('reads the record, never assumes', () => {
    expect(presenterCropMode('asset:aaa', 'asset:aaa')).toBe('upload');
    expect(presenterCropMode('asset:aaa', 'asset:bbb')).toBe('generated');
    expect(presenterCropMode('asset:aaa', undefined)).toBe('generated');
  });
});

describe('repairPresenterCrops', () => {
  it('repairs a record whose avatar is the raw shot, then leaves it alone', async () => {
    const hash = core.images.save(await png('#884422'));
    // the pre-fix shape: avatar points at the raw photograph itself
    const brand = seedBrand([
      {
        id: 'up-old00001',
        name: 'Mara',
        origin: 'custom',
        shots: [{ file: `asset:${hash}`, locked: true }],
        sourceRefs: [{ file: `asset:${hash}` }],
        avatar: `asset:${hash}`,
      },
    ]);

    const first = await repairPresenterCrops(core);
    expect(first.repaired).toBe(1);
    const fixed = charOf(brand.id);
    expect(fixed.avatar).toMatch(/^asset:[a-f0-9]{32}$/);
    expect(fixed.avatar).not.toBe(`asset:${hash}`);
    expect(fixed.preview).toMatch(/^asset:[a-f0-9]{32}$/);
    // the photographs themselves are never touched
    expect(fixed.shots[0].file).toBe(`asset:${hash}`);
    expect(fixed.sourceRefs[0].file).toBe(`asset:${hash}`);

    // idempotence is structural: the second boot recomputes identical hashes
    const before = JSON.stringify(core.store.getBrand(brand.id)!.json);
    const second = await repairPresenterCrops(core);
    expect(second.repaired).toBe(0);
    expect(JSON.stringify(core.store.getBrand(brand.id)!.json)).toBe(before);
  });

  it('gives a record with no thumbnails at all both of them', async () => {
    const hash = core.images.save(await png('#224488'));
    const brand = seedBrand([
      {
        id: 'up-old00002',
        name: 'Noor',
        origin: 'custom',
        shots: [{ file: `asset:${hash}`, locked: true }],
        sourceRefs: [{ file: `asset:${hash}` }],
      },
    ]);
    const { repaired } = await repairPresenterCrops(core);
    expect(repaired).toBe(1);
    const fixed = charOf(brand.id);
    expect(fixed.avatar).toMatch(/^asset:/);
    expect(fixed.preview).toMatch(/^asset:/);
  });

  it('repairs a legacy roster row that predates the origin marker', async () => {
    // The real Bree/Astrid shape: a valid first shot, no origin field, no
    // avatar. Gating repair on origin === 'custom' left exactly these rows
    // stuck with no derived avatar forever.
    const hash = core.images.save(await png('#446622'));
    const brand = seedBrand([{ id: 'c-legacy77', name: 'Bree', shots: [{ file: `asset:${hash}`, locked: true }] }]);
    const { repaired } = await repairPresenterCrops(core);
    expect(repaired).toBe(1);
    const fixed = charOf(brand.id);
    expect(fixed.avatar).toMatch(/^asset:[a-f0-9]{32}$/);
    expect(fixed.preview).toMatch(/^asset:[a-f0-9]{32}$/);
    expect(fixed.shots[0].file).toBe(`asset:${hash}`);
  });

  it('skips rows with nothing to read: shotless, id-less or broken image refs', async () => {
    seedBrand([
      { id: 'legacy-1', name: 'Old Cast', shots: [{ file: 'asset:deadbeef' }] },
      { id: 'up-nophoto', name: 'Ghost', origin: 'custom' },
      { id: 'up-broken1', name: 'Torn', origin: 'custom', shots: [{ file: `asset:${'f'.repeat(32)}` }] },
      { name: 'No Id', shots: [{ file: 'asset:deadbeef' }] },
    ]);
    const { repaired } = await repairPresenterCrops(core);
    expect(repaired).toBe(0);
  });
});

describe('a portrait-led record', () => {
  it('names its crop mode from the leading angle, unless the shot is one of the photographs', () => {
    expect(presenterCropMode('asset:aaa', 'asset:bbb', 'portrait')).toBe('portrait');
    expect(presenterCropMode('asset:aaa', ['asset:bbb', 'asset:ccc'], 'portrait')).toBe('portrait');
    // a photograph filed as the portrait is still a photograph: saliency, not studio geometry
    expect(presenterCropMode('asset:aaa', 'asset:aaa', 'portrait')).toBe('upload');
    expect(presenterCropMode('asset:aaa', ['asset:bbb', 'asset:aaa'], 'portrait')).toBe('upload');
    expect(presenterCropMode('asset:aaa', 'asset:bbb', 'front')).toBe('generated');
  });

  it('is mended with portrait crops, and then left alone', async () => {
    // The shape every engine-built presenter has had since the portrait frame
    // was prepended: shots[0] is head-and-shoulders. The boot repair used to
    // read it as a standing figure and carve an avatar out of a forehead.
    const portrait = core.images.save(await png('#8a6a5a'));
    const front = core.images.save(await png('#224488'));
    const brand = seedBrand([
      {
        id: 'up-port0001',
        name: 'Ilse',
        origin: 'custom',
        shots: [
          { file: `asset:${portrait}`, angle: 'portrait', locked: true },
          { file: `asset:${front}`, angle: 'front', locked: true },
        ],
        sourceRefs: [{ file: `asset:${'a'.repeat(32)}` }],
        avatar: `asset:${front}`,
        preview: `asset:${front}`,
      },
    ]);
    const first = await repairPresenterCrops(core);
    expect(first.repaired).toBe(1);
    const fixed = charOf(brand.id);
    const want = await presenterCrops(core, portrait, 'portrait');
    expect(fixed.avatar).toBe(`asset:${want.avatarHash}`);
    expect(fixed.preview).toBe(`asset:${portrait}`);
    const second = await repairPresenterCrops(core);
    expect(second.repaired).toBe(0);
  });
});
