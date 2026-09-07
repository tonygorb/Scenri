import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core } from '../src/index.js';

/**
 * A presenter draft is cast-in-progress: approved views, a candidate, the
 * photos it was started from. It outlives a page reload and a server restart,
 * which is why it is a row and not a Map, and it dies with its brand.
 */

let home: string;
let core: Core;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-pdraft-'));
  core = createCore(home);
});
afterEach(() => {
  core.close();
  rmSync(home, { recursive: true, force: true });
});

const brandJson = { specVersion: '0.1', meta: { name: 'Acme Coffee' } };
const HASH_A = 'a'.repeat(32);
const HASH_B = 'b'.repeat(32);

describe('presenter drafts', () => {
  it('stores a draft as opaque JSON and reads it back by id', () => {
    const brand = core.store.createBrand(brandJson as any);
    const row = core.store.putPresenterDraft({ id: 'pd-1', brandId: brand.id, json: { source: 'synthetic', step: 1 } });
    expect(row.id).toBe('pd-1');
    expect(row.brandId).toBe(brand.id);
    expect(row.json).toEqual({ source: 'synthetic', step: 1 });
    expect(core.store.getPresenterDraft('pd-1')?.json).toEqual({ source: 'synthetic', step: 1 });
    expect(core.store.getPresenterDraft('pd-missing')).toBeNull();
  });

  it('put is an upsert: the same id replaces the json and moves updated_at forward', () => {
    const brand = core.store.createBrand(brandJson as any);
    const first = core.store.putPresenterDraft({ id: 'pd-1', brandId: brand.id, json: { step: 1 } });
    const second = core.store.putPresenterDraft({ id: 'pd-1', brandId: brand.id, json: { step: 2 } });
    expect(second.json).toEqual({ step: 2 });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt >= first.updatedAt).toBe(true);
    expect(core.store.listPresenterDrafts(brand.id)).toHaveLength(1);
  });

  it("lists a brand's drafts most recently touched first, and only that brand's", async () => {
    const acme = core.store.createBrand(brandJson as any);
    const other = core.store.createBrand({ ...brandJson, meta: { name: 'Other' } } as any);
    core.store.putPresenterDraft({ id: 'pd-old', brandId: acme.id, json: {} });
    core.store.putPresenterDraft({ id: 'pd-new', brandId: acme.id, json: {} });
    core.store.putPresenterDraft({ id: 'pd-theirs', brandId: other.id, json: {} });
    // touch the old one so it leads (a beat later: stamps are milliseconds)
    await new Promise((r) => setTimeout(r, 5));
    core.store.putPresenterDraft({ id: 'pd-old', brandId: acme.id, json: { touched: true } });
    const ids = core.store.listPresenterDrafts(acme.id).map((d) => d.id);
    expect(ids).toEqual(['pd-old', 'pd-new']);
  });

  it('deletes a draft, and a brand takes its drafts with it', () => {
    const brand = core.store.createBrand(brandJson as any);
    core.store.putPresenterDraft({ id: 'pd-1', brandId: brand.id, json: {} });
    core.store.putPresenterDraft({ id: 'pd-2', brandId: brand.id, json: {} });
    core.store.deletePresenterDraft('pd-1');
    expect(core.store.getPresenterDraft('pd-1')).toBeNull();
    expect(core.store.getPresenterDraft('pd-2')).not.toBeNull();
    core.store.deleteBrand(brand.id);
    expect(core.store.getPresenterDraft('pd-2')).toBeNull();
  });
});

describe('imageReferenced: what stops a stored image from being removed', () => {
  it('is false for a hash nothing in the database mentions', () => {
    expect(core.store.imageReferenced(HASH_A)).toBe(false);
  });

  it('is true when a shot lists the hash among its images', () => {
    const brand = core.store.createBrand(brandJson as any);
    const ws = core.store.workspaceFor(brand.id);
    const n = core.store.addNode({
      projectId: ws.id,
      parentId: null,
      kind: 'generation',
      prompt: 'x',
      engineId: 'demo',
    });
    core.store.completeNode(n.id, { images: [HASH_A], costUsd: 0 });
    expect(core.store.imageReferenced(HASH_A)).toBe(true);
    expect(core.store.imageReferenced(HASH_B)).toBe(false);
  });

  it("is true when a shot's brief carries the hash (a source image or an attachment)", () => {
    const brand = core.store.createBrand(brandJson as any);
    const ws = core.store.workspaceFor(brand.id);
    const n = core.store.addNode({ projectId: ws.id, parentId: null, kind: 'edit', prompt: 'x', engineId: 'demo' });
    core.store.setBrief(n.id, { sourceImage: HASH_B });
    expect(core.store.imageReferenced(HASH_B)).toBe(true);
  });

  it('is true when another presenter draft holds the hash: two drafts of one photo share one file', () => {
    const brand = core.store.createBrand(brandJson as any);
    core.store.putPresenterDraft({ id: 'pd-1', brandId: brand.id, json: { sources: [HASH_A] } });
    expect(core.store.imageReferenced(HASH_A)).toBe(true);
  });

  it('is true when an imported catalog image resolved to the hash', () => {
    const brand = core.store.createBrand(brandJson as any);
    const source = core.catalog.upsertSource(brand.id, 'https://acme.example', 'shopify');
    const product = core.catalog.upsertProduct({
      sourceId: source.id,
      brandId: brand.id,
      externalKey: 'p1',
      title: 'Mug',
      url: 'https://acme.example/products/mug',
      price: 12,
      images: [],
      variants: [],
    });
    core.catalog.addLocalImage(product.id, `asset:${HASH_B}`);
    expect(core.store.imageReferenced(HASH_B)).toBe(true);
  });
});

describe('images.remove', () => {
  it('unlinks a stored image and reports whether there was one', () => {
    const hash = core.images.save(Buffer.from('not really a png'));
    expect(existsSync(core.images.pathFor(hash))).toBe(true);
    expect(core.images.remove(hash)).toBe(true);
    expect(existsSync(core.images.pathFor(hash))).toBe(false);
    expect(core.images.has(hash)).toBe(false);
    expect(core.images.remove(hash)).toBe(false);
  });

  it('refuses a hash that is not one', () => {
    expect(() => core.images.remove('../../etc/passwd')).toThrow(/invalid image hash/);
  });
});
