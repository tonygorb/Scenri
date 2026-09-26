import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, type Page, test } from '@playwright/test';
import { arrived, isolate } from './harness.js';
import { currentBrand, uploadPng } from './realtime.js';

/**
 * What a real browser does with the studio from outside: a page on another
 * port of this computer posting to Scenri, hostile words in names and
 * directions, and an iPhone photo the store cannot read yet.
 */
isolate({ env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '4' } });

const PIXEL_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** A 64x48 HEVC HEIC, as an iPhone or `sips -s format heic` writes it (626 bytes). */
const HEIC_B64 =
  'AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABw21ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABodmMxAAAAABVpbmZlAgAAAQACAABFeGlmAAAAABppcmVmAAAAAAAAAA5jZHNjAAIAAQABAAAA5mlwcnAAAADFaXBjbwAAABNjb2xybmNseAACAAIABoAAAAAMY2xsaQDLAEAAAAAUaXNwZQAAAAAAAABAAAAAMAAAAAlpcm90AAAAABBwaXhpAAAAAAMICAgAAABxaHZjQwEDcAAAALAAAAAAAB7wAPz9+PgAAAsDoAABABdAAQwB//8DcAAAAwCwAAADAAADAB5wJKEAAQAjQgEBA3AAAAMAsAAAAwAAAwAeoBQgQcGMTiHuRZVNwICBgCCiAAEACUQBwGFyyERTZAAAABlpcG1hAAAAAAAAAAEAAQaBAgMFhoQAAAAsaWxvYwAAAABEAAACAAEAAAABAAACQwAAAC8AAgAAAAEAAAH3AAAATAAAAAFtZGF0AAAAAAAAAIsAAAAGRXhpZgAATU0AKgAAAAgAAwEaAAUAAAABAAAAMgEbAAUAAAABAAAAOgEoAAMAAAABAAIAAAAAAAAAAAAZAAAAAQAAABkAAAABAAAAKygBr6L2RoF8//ww3//HH7L6KEPsNrRPOvP70Zn/9RNP6f/QPm4HCZqbVH4=';
const heic = () => ({ name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: Buffer.from(HEIC_B64, 'base64') });

test('a page on another localhost port can neither sign out every phone nor store a file (SEC-H9)', async ({
  page,
  request,
  baseURL,
}) => {
  // another app on this computer, on whatever port was free
  const other: Server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>another app on this computer</title><p>hello</p>');
  });
  await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
  const port = (other.address() as AddressInfo).port;
  try {
    const codeBefore = ((await (await request.get('/api/phone')).json()) as { code: string }).code;
    const imagesBefore = ((await (await request.get('/api/home')).json()) as { images: number }).images;

    await page.goto(`http://127.0.0.1:${port}/`);
    // both are "simple" requests: no preflight, so the browser sends them and only hides the answer
    await page.evaluate(
      async ({ base, png }) => {
        const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
        const fd = new FormData();
        fd.append('file', new Blob([bytes], { type: 'image/png' }), 'x.png');
        await fetch(`${base}/api/phone/code`, { method: 'POST', mode: 'no-cors' }).catch(() => null);
        await fetch(`${base}/api/images`, { method: 'POST', mode: 'no-cors', body: fd }).catch(() => null);
      },
      { base: baseURL as string, png: PIXEL_B64 },
    );

    const codeAfter = ((await (await request.get('/api/phone')).json()) as { code: string }).code;
    const imagesAfter = ((await (await request.get('/api/home')).json()) as { images: number }).images;
    expect({ codeChanged: codeAfter !== codeBefore, stored: imagesAfter - imagesBefore }).toEqual({
      codeChanged: false,
      stored: 0,
    });
  } finally {
    await new Promise<void>((resolve) => other.close(() => resolve()));
  }
});

/* ---- user text is text */

const NAME = '<img src=x onerror="window.__sec2=1">‮gnp.exe';
const LONG = 'W'.repeat(140);
const DIRECTION = `<script>window.__sec2=2</script> a woman in her 30s, <b>bold</b> ‮desrever‬ javascript:window.__sec2=3 ${LONG}`;
const KEEP = `<img src=x onerror="window.__sec2=4"> a rose tattoo ⁧on the wrist⁩ ${LONG.slice(0, 60)}`;
const SCENE_NAME = '<svg onload="window.__sec2=5">‮tfol';
const SCENE_DIRECTION = `<img src=x onerror="window.__sec2=6"> keep the brick wall ${LONG}`;

/** Nothing ran, nothing was parsed as markup, and the page does not scroll sideways. */
async function expectInert(page: Page, where: string) {
  const state = await page.evaluate(() => ({
    ran: (window as unknown as { __sec2?: number }).__sec2 ?? null,
    injected:
      document.querySelectorAll('img[src="x"], svg[onload]').length +
      [...document.scripts].filter((s) => s.textContent?.includes('__sec2')).length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(state, where).toEqual({ ran: null, injected: 0, overflow: 0 });
}

test('names, directions and details with markup, bidi and long words render as inert text (SEC2-TEXT)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  const brand = await currentBrand(page);
  const req = page.request;
  const hash = await uploadPng(req, 1);

  const saved = await req.post(`/api/brands/${brand.id}/presenters`, {
    data: { name: NAME, shotHashes: [hash], descriptor: DIRECTION.slice(0, 120), identityNotes: DIRECTION },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const presenterId = ((await saved.json()) as { presenter: { id: string } }).presenter.id;

  const draft = await req.post(`/api/brands/${brand.id}/presenter-drafts`, {
    data: { source: 'synthetic', name: NAME, direction: DIRECTION, keepItems: [{ id: 'tattoo', words: KEEP }] },
  });
  expect(draft.ok(), await draft.text()).toBe(true);
  const draftId = ((await draft.json()) as { id: string }).id;

  const scene = await req.post(`/api/brands/${brand.id}/scenes`, {
    data: {
      name: SCENE_NAME,
      prompt: `a brick loft ${LONG}`,
      description: SCENE_DIRECTION.slice(0, 400),
      instruction: SCENE_DIRECTION,
      refHashes: [hash],
    },
  });
  expect(scene.ok(), await scene.text()).toBe(true);
  const sceneId = ((await scene.json()) as { scene: { id: string } }).scene.id;

  const surfaces: [string, string][] = [
    ['presenters wall', `/${brand.slug}/presenters`],
    ['presenter page', `/${brand.slug}/presenters/${presenterId}`],
    ['presenter studio', `/${brand.slug}/presenters/new/${draftId}`],
    ['scenes wall', `/${brand.slug}/scenes`],
    ['scene page', `/${brand.slug}/scenes/${sceneId}`],
    ['scene studio', `/${brand.slug}/scenes/${sceneId}/edit`],
  ];
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const [name, path] of surfaces) {
      await page.goto(path);
      await expect(page.locator('main').first()).toBeVisible();
      await page.waitForTimeout(400);
      await expectInert(page, `${name} at ${viewport.width}px`);
    }
  }
  expect(dialogs).toEqual([]);
});

/* ---- an iPhone photo: said honestly, never sent where it cannot be read */

test('a HEIC photo added to a new presenter is refused, and the studio says to export it as JPEG (SEC2-X1)', async ({
  page,
}) => {
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/presenters/new`);
  await page.getByRole('log').getByRole('button', { name: 'Add photos', exact: true }).click();
  const upload = page.waitForResponse((r) => /\/api\/images$/.test(r.url()) && r.request().method() === 'POST');
  await page.locator('input[type="file"]').setInputFiles(heic());
  expect((await upload).status()).toBe(400);
  await expect(
    page.getByText(/IMG_0001\.HEIC is a HEIC photo, which Scenri cannot read yet\. Export it as JPEG/),
  ).toBeVisible();
  await expect(page.locator('.sc-assetform-ref')).toHaveCount(0);
});

test('a HEIC picture handed to a new scene is refused with its note, and never sent (SEC2-X1)', async ({ page }) => {
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/scenes/new`);
  const studio = page.locator('.sc-pstudio[data-kind="scene"]');
  await arrived(page, '.sc-pstudio[data-kind="scene"]');
  await studio.locator('[data-turn="q:source"]').getByRole('button', { name: 'Add pictures', exact: true }).click();
  const q = studio.locator('[data-turn="q:photos"]');
  await expect(q).toBeVisible();
  let uploads = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/images') uploads += 1;
  });
  await q.locator('input[type="file"]').setInputFiles(heic());
  await expect(studio).toContainText('HEIC pictures cannot be read yet. Export them as JPEG, then add them.');
  await expect(q.locator('.sc-assetform-ref img')).toHaveCount(0);
  expect(uploads).toBe(0);
});
