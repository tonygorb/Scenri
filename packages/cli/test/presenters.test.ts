import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { loadPresenters, presenterResolver, presenterFacetsOf, type Presenter } from '../src/presenters.js';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

const base: Presenter = {
  id: 'ok',
  name: 'Ok',
  presentation: 'woman',
  descriptor: 'd',
  ageRange: '20s',
  facial: 'f',
  skin: 's',
  hair: 'h',
  build: 'b',
  wardrobeDefault: 'w',
  suitableCategories: ['Beauty'],
  suitableStyles: ['Editorial'],
  identityNotes: 'The gap tooth stays.',
  negativeConstraints: ['never freckles'],
  width: 10,
  height: 10,
};

describe('presenter loader', () => {
  it('loads valid presenters and skips bad files with a warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sc-presenter-'));
    writeFileSync(join(dir, 'ok.json'), JSON.stringify(base));
    writeFileSync(join(dir, 'bad.json'), '{nope');
    writeFileSync(join(dir, 'incomplete.json'), JSON.stringify({ id: 'x' }));
    writeFileSync(
      join(dir, 'presentation.json'),
      JSON.stringify({ ...base, id: 'presentation', presentation: 'vibes' }),
    );
    const { presenters, warnings } = loadPresenters(dir);
    expect(presenters.map((p) => p.id)).toEqual(['ok']);
    expect(warnings).toHaveLength(3);
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('resolves by id, and answers undefined for an unknown one', () => {
    const resolve = presenterResolver([base]);
    expect(resolve('ok')?.name).toBe('Ok');
    expect(resolve('never-existed')).toBeUndefined();
  });

  it('reports the categories and styles actually in use, sorted', () => {
    const { categories, styles } = presenterFacetsOf([
      base,
      { ...base, id: 'two', suitableCategories: ['Apparel'], suitableStyles: ['Lifestyle'] },
    ]);
    expect(categories).toEqual(['Apparel', 'Beauty']);
    expect(styles).toEqual(['Editorial', 'Lifestyle']);
  });
});

describe('presenter catalog + direct-attach API', () => {
  let templatesDir: string;
  let refDir: string;
  let home: string;
  let core: Core;
  let app: FastifyInstance;

  const spy: EngineAdapter = {
    capabilities: () => ({
      id: 'spy',
      displayName: 'Spy',
      localOnly: false,
      supportsEdit: true,
      supportsMask: false,
      maxReferenceImages: 2,
    }),
    isAvailable: async () => ({ ok: true }),
    costEstimate: async () => 0,
    generate: async () => ({ images: [], costUsd: 0 }),
    edit: async () => ({ images: [], costUsd: 0 }),
  };

  beforeEach(async () => {
    templatesDir = mkdtempSync(join(tmpdir(), 'sc-presenter-templates-'));
    mkdirSync(join(templatesDir, 'presenters'), { recursive: true });
    writeFileSync(join(templatesDir, 'presenters', 'sana.json'), JSON.stringify({ ...base, id: 'sana', name: 'Sana' }));

    refDir = join(templatesDir, 'previews', 'presenters', 'sana');
    mkdirSync(refDir, { recursive: true });
    // Distinct bytes per file. The store is content-addressed, so identical
    // fixtures collapse to one hash and any assertion about WHICH view rides,
    // or in what order, would pass on a single picture.
    const jpg = async (tint: string) =>
      sharp({ create: { width: 4, height: 4, channels: 3, background: tint } })
        .jpeg()
        .toBuffer();
    writeFileSync(join(refDir, 'ref-01.jpg'), await jpg('#334455'));
    writeFileSync(join(refDir, 'ref-02.jpg'), await jpg('#445566'));
    writeFileSync(join(refDir, 'avatar.jpg'), await jpg('#556677'));
    writeFileSync(join(templatesDir, 'previews', 'presenters', 'sana.jpg'), await jpg('#667788'));

    home = mkdtempSync(join(tmpdir(), 'sc-presenter-home-'));
    core = createCore(home);
    app = buildServer({
      core,
      engines: { all: () => [spy], get: (id) => (id === 'spy' ? spy : null) },
      templatesDir,
    });
  });

  afterEach(async () => {
    await app.drain();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(templatesDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const newBrand = async () =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' } } },
      })
    ).json();

  it('lists the catalog with facets and a thumbnail url', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/presenters' });
    const body = res.json();
    expect(body.presenters).toHaveLength(1);
    expect(body.presenters[0].name).toBe('Sana');
    expect(body.presenters[0].previewUrl).toMatch(/^\/api\/presenter-thumbnails\/sana\.jpg\?v=\d+$/);
    expect(body.categories).toContain('Beauty');
    expect(body.styles).toContain('Editorial');
  });

  it('serves the avatar and the card thumbnail at a derivative width on request', async () => {
    const jpeg = await app.inject({ method: 'GET', url: '/api/presenter-avatars/sana.jpg' });
    expect(jpeg.headers['content-type']).toBe('image/jpeg');

    const sized = await app.inject({ method: 'GET', url: '/api/presenter-avatars/sana.jpg?v=1&w=320' });
    expect(sized.statusCode).toBe(200);
    expect(sized.headers['content-type']).toBe('image/webp');
    expect(sized.headers['cache-control']).toContain('immutable');
    expect(sized.headers.etag).toMatch(/^"avatar-sana-\d+-w320"$/);
    const meta = await sharp(sized.rawPayload).metadata();
    expect(meta.format).toBe('webp');
    // a 4px fixture is never enlarged
    expect(meta.width).toBe(4);
    expect(readdirSync(join(home, 'thumbs')).some((f) => /^f-avatar-sana-\d+-w320\.webp$/.test(f))).toBe(true);

    const cached = await app.inject({
      method: 'GET',
      url: '/api/presenter-avatars/sana.jpg?w=320',
      headers: { 'if-none-match': String(sized.headers.etag) },
    });
    expect(cached.statusCode).toBe(304);
    expect((await app.inject({ method: 'GET', url: '/api/presenter-avatars/sana.jpg?w=999' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/presenter-avatars/nope.jpg?w=320' })).statusCode).toBe(404);

    const card = await app.inject({ method: 'GET', url: '/api/presenter-thumbnails/sana.jpg?w=640' });
    expect(card.statusCode).toBe(200);
    expect(card.headers['content-type']).toBe('image/webp');
    expect(card.headers.etag).toMatch(/^"presenter-sana-\d+-w640"$/);
  });

  it('exposes the square avatar without letting it become a reference frame', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/presenters' })).json();
    expect(body.presenters[0].avatarUrl).toMatch(/^\/api\/presenter-avatars\/sana\.jpg\?v=\d+$/);

    const ok = await app.inject({ method: 'GET', url: '/api/presenter-avatars/sana.jpg' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    const missing = await app.inject({ method: 'GET', url: '/api/presenter-avatars/nope.jpg' });
    expect(missing.statusCode).toBe(404);

    // The avatar sits in the same directory as the reference frames but is a UI
    // asset, not part of the identity plan: it must never show up as a 3rd frame.
    const frames = (await app.inject({ method: 'GET', url: '/api/presenter-previews/sana' })).json().frames;
    expect(frames).toHaveLength(2);
    expect(frames.join(' ')).not.toContain('avatar');
  });

  it('serves the thumbnail and 404s an unknown one', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/presenter-thumbnails/sana.jpg' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    const missing = await app.inject({ method: 'GET', url: '/api/presenter-thumbnails/nope.jpg' });
    expect(missing.statusCode).toBe(404);
  });

  it("lists a presenter's reference frames, and answers empty rather than 404 for one with no set", async () => {
    const withSet = (await app.inject({ method: 'GET', url: '/api/presenter-previews/sana' })).json();
    expect(withSet.frames).toHaveLength(2);
    expect(withSet.frames[0]).toMatch(/^\/api\/presenter-previews\/sana\/ref-01\.jpg\?v=\d+$/);
    expect(withSet.frames[1]).toMatch(/^\/api\/presenter-previews\/sana\/ref-02\.jpg\?v=\d+$/);
    const frame = await app.inject({ method: 'GET', url: '/api/presenter-previews/sana/ref-01.jpg' });
    expect(frame.statusCode).toBe(200);

    const without = await app.inject({ method: 'GET', url: '/api/presenter-previews/no-such-presenter' });
    expect(without.statusCode).toBe(200);
    expect(without.json().frames).toEqual([]);
  });

  it('a brief can name a curated presenter directly, with no cast/roster step first', async () => {
    const brand = await newBrand();
    const res = await app.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: {
        brandId: brand.id,
        engineId: 'spy',
        brief: {
          tokens: [
            { t: 'character', id: 'sana' },
            { t: 'text', v: 'in a studio' },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.prompt).toContain('Sana');
    /*
     * The portrait leads the identity plan.
     *
     * avatar.jpg is 1024x1024 of head and shoulders, so the face is around
     * 450px brow to chin; ref-01 is a 1024x1280 full-length frame whose face
     * is about 105px. It used to be excluded from generation as "a display
     * asset", which meant roughly eighteen times the facial pixels shipped
     * with every curated presenter and never left the disk. Four outputs of
     * one brief came back with four different jaws.
     */
    // This engine carries two references, so this also pins what survives a
    // tight budget: the face, then the standing view.
    expect(body.attachments.map((a: { role: string }) => a.role)).toEqual(['character', 'character']);
    expect(body.attachments[0].essential).toBe(true);
    const avatarHash = core.images.save(
      await sharp(readFileSync(join(refDir, 'avatar.jpg')))
        .png()
        .toBuffer(),
    );
    expect(body.attachments[0].hash).toBe(avatarHash);
    // The casting sheet travels: a curated presenter's identityNotes and
    // negativeConstraints reach the prompt exactly as a roster character's do.
    // They used to be dropped by resolvePresenterImages, so a curated
    // presenter contributed nothing but a name and two photos.
    expect(body.prompt).toContain('The gap tooth stays.');
    expect(body.prompt).toContain('Avoid: never freckles');
    // The record's own skin truth rides too - it was dropped here, which is
    // half of the airbrushed-presenter report.
    expect(body.prompt).toContain("Sana's skin, exactly as the reference photographs show it: s.");
    // And the face. `facial` and `build` were held back on the grounds that
    // they are geometry the four reference photographs already lock; the
    // photographs are full-length, so the face lands at about 105px and locks
    // nothing. Four outputs of one brief came back with four different jaws.
    expect(body.prompt).toContain("Sana's face, which must survive every generation unchanged: f.");
    expect(body.prompt).toContain("Sana's build: b.");
    // `hair` still does not ride: a direction legitimately restyles it, and
    // identityNotes already asserts whatever must survive.
    expect(body.prompt).not.toContain("Sana's hair");

    // resolving the presenter is a read-through cache, not a roster write —
    // the brand's own characters[] stays exactly as it started
    const brands = await app.inject({ method: 'GET', url: '/api/brands' });
    const brandNow = brands.json().find((b: any) => b.id === brand.id);
    expect(brandNow.json.characters ?? []).toHaveLength(0);
  });

  it('a brief naming an unknown character warns instead of failing', async () => {
    const brand = await newBrand();
    const res = await app.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: {
        brandId: brand.id,
        engineId: 'spy',
        brief: { tokens: [{ t: 'character', id: 'nope' }] },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().warnings).toContain('A presenter in this brief is no longer in your roster.');
  });
});
