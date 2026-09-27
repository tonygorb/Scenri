import { expect, type Page, test } from '@playwright/test';
import { arrived, isolate } from './harness.js';
import { LOGO, picture } from './pictures.js';

/**
 * Nothing here can read a picture or draw one. Pictures of a place still go
 * in, and any picture is a fair thing to start a scene from, a logo included;
 * what needs Codex is reading them, so Read them stops at the setup line,
 * calmly, the pictures kept. An upload is never the scene's picture: not its
 * place, not its hero, not its card.
 */
isolate({ shot: false, env: { SCENRI_DEMO_ENGINE: '0', SCENRI_DEMO_BUILDS: '0' } });

const GATE = 'Reading pictures needs Codex, which is not set up yet.';

async function currentBrand(p: Page): Promise<{ slug: string; id: string }> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
  const brands = (await (await p.request.get('/api/brands')).json()) as { id: string; slug: string }[];
  return { slug, id: brands.find((b) => b.slug === slug)?.id ?? brands[0].id };
}

const studio = (p: Page) => p.locator('.sc-pstudio[data-kind="scene"]');
const openQ = (p: Page) => studio(p).locator('[data-turn^="q:"]').last();
const tap = (p: Page, name: string) => openQ(p).getByRole('button', { name, exact: true }).click();

async function scenesOf(p: Page, brandId: string): Promise<any[]> {
  const brands = await (await p.request.get('/api/brands')).json();
  return brands.find((b: any) => b.id === brandId).json.scenes ?? [];
}

test('a logo at the picture door stays a picture: Read them stops at the setup line, and nothing is saved', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/scenes/new`);
  await arrived(page, '.sc-pstudio[data-kind="scene"]');
  await tap(page, 'Add pictures');
  await openQ(page).locator('input[type="file"]').setInputFiles(picture('acme-logo.png', LOGO));
  await expect(openQ(page).locator('.sc-assetform-ref')).toHaveCount(1);
  let reads = 0;
  page.on('request', (r) => {
    if (r.url().includes('/scene-studio/jobs') && r.method() === 'POST') reads++;
  });
  await tap(page, 'Read them');

  // said as the setup line, never as a failure, and no read was asked for
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:noreader');
  await expect(studio(page).getByRole('log')).toContainText(GATE);
  await expect(studio(page).getByRole('log')).not.toContainText('did not go through');
  await expect(openQ(page).getByRole('button', { name: 'Set up', exact: true })).toBeVisible();
  await expect(studio(page).locator('[data-turn="you:photos"] img')).toHaveCount(1);
  expect(reads).toBe(0);
  // the logo is nowhere as the place
  await expect(page.locator('.sc-pstudio-well img')).toHaveCount(0);
  expect(await scenesOf(page, brand.id)).toEqual([]);

  // a reload keeps the picture where it was; Read them asks again, and stops again
  await page.reload();
  await arrived(page, '.sc-pstudio[data-kind="scene"]');
  await expect(openQ(page).locator('.sc-assetform-ref')).toHaveCount(1);
  await tap(page, 'Read them');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:noreader');

  // and back to the pictures, the logo still there, with nothing to upload again
  await tap(page, 'Change pictures');
  await expect(openQ(page).locator('.sc-assetform-ref')).toHaveCount(1);
  await expect(openQ(page).getByRole('button', { name: 'Read them', exact: true })).toBeVisible();
  expect(reads).toBe(0);
  expect(await scenesOf(page, brand.id)).toEqual([]);
});

test('a scene saved as words keeps its upload as what it was read from, never as its card', async ({ page }) => {
  // What the words-only save leaves when something could read but nothing
  // could draw: a scene with references and no picture of its own.
  const brand = await currentBrand(page);
  const up = await page.request.post('/api/images', { multipart: { file: picture('acme-logo.png', LOGO) } });
  const hash = (await up.json()).hash as string;
  const made = await page.request.post(`/api/brands/${brand.id}/scenes`, {
    data: {
      name: 'Words Loft',
      prompt: 'A bright loft with pale timber floors.',
      lighting: 'Soft window light',
      refHashes: [hash],
    },
  });
  expect(made.status()).toBe(200);
  expect((await made.json()).scene.preview ?? null).toBeNull();

  await page.goto(`/${brand.slug}/scenes`);
  const card = page.getByRole('link', { name: 'Words Loft', exact: true });
  await expect(card).toBeVisible();
  // the card has no picture: the logo it was read from is not its face
  await expect(card.locator(`img[src*="${hash}"]`)).toHaveCount(0);
  await expect(page.locator(`img[src*="${hash}"]`)).toHaveCount(0);
});
