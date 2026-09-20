import { expect, type Page, test } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * A scene's own page: the record of a world you can shoot in.
 *
 * The claims here are what the page is for, not how it is laid out: the name
 * and the one verb that uses it, the pictures of the place large enough to
 * judge and openable, what a shot is told in words, and a delete that every
 * other surface hears about in the same commit.
 */
isolate();

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function brand(p: Page): Promise<{ id: string; slug: string }> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
  const brands = await (await p.request.get('/api/brands')).json();
  return { id: brands[0].id, slug };
}

/**
 * A saved scene, written the way the studio writes one.
 *
 * Its own name per test: the tests in a file share one library, so a name used
 * twice makes "it is gone from the wall" pass or fail on somebody else's copy.
 */
async function scene(p: Page, brandId: string, name: string, over: Record<string, unknown> = {}) {
  const up = await p.request.post('/api/images', {
    multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: PNG } },
  });
  const hash = up.ok() ? ((await up.json()).hash as string) : undefined;
  const r = await p.request.post(`/api/brands/${brandId}/scenes`, {
    data: {
      name,
      prompt: 'A wet basalt shelf under flat daylight, the sea behind it.',
      lighting: 'Overcast daylight, no shadow edge',
      description: 'A cold shore of black rock.',
      instruction: 'a cold black shore under flat light',
      ...(hash ? { refHashes: [hash], previewHash: hash } : {}),
      ...over,
    },
  });
  return (await r.json()).scene as { id: string; name: string };
}

test('says what the place is and what a shot made here is told', async ({ page }) => {
  const b = await brand(page);
  const s = await scene(page, b.id, 'Wet Basalt Shore');
  await page.goto(`/${b.slug}/scenes/${s.id}`);

  await expect(page.getByRole('heading', { level: 1, name: 'Wet Basalt Shore' })).toBeVisible();
  // the one verb that uses it, loudest
  await expect(page.locator('.sc-lookpage-acts .sc-btn-primary')).toHaveText('Use in a shot');
  await expect(page.getByRole('link', { name: 'Edit scene' })).toBeVisible();
  // the words every shot is told, as words and not as a form
  await expect(page.getByText('What your shots are told')).toBeVisible();
  await expect(page.getByText('A wet basalt shelf under flat daylight')).toBeVisible();
  await expect(page.getByText('Overcast daylight, no shadow edge')).toBeVisible();
  // your own words are kept beside them
  await expect(page.getByText('a cold black shore under flat light')).toBeVisible();
});

test('the pictures of the place are large enough to judge, and open at full size', async ({ page }) => {
  const b = await brand(page);
  const s = await scene(page, b.id, 'Basalt Frames');
  await page.goto(`/${b.slug}/scenes/${s.id}`);

  const tile = page.locator('.sc-refset-tile').first();
  await expect(tile).toBeVisible();
  // a scene has no avatar, so its one picture is its identity: not a thumbnail
  const box = await tile.boundingBox();
  expect(box!.width).toBeGreaterThan(420);

  await tile.click();
  const shown = page.getByRole('dialog');
  await expect(shown).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(shown).toHaveCount(0);
  // the keyboard comes back to the picture that was opened, not the page behind
  await expect(tile).toBeFocused();
});

test('what it was read from is shown as evidence, never as the place itself', async ({ page }) => {
  const b = await brand(page);
  const s = await scene(page, b.id, 'Basalt Evidence');
  await page.goto(`/${b.slug}/scenes/${s.id}`);

  await expect(page.getByText('What it was read from')).toBeVisible();
  await expect(page.getByText('never sent with a shot')).toBeVisible();
  await page.getByRole('button', { name: 'Read from 1, open' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('deleting it is gone from the library in the same commit, with no reload', async ({ page }) => {
  const b = await brand(page);
  const s = await scene(page, b.id, 'Basalt To Delete');
  await page.goto(`/${b.slug}/scenes/${s.id}`);

  await page.getByRole('button', { name: 'Delete scene' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete scene' }).click();
  await page.waitForURL(new RegExp(`/${b.slug}/scenes$`));
  await expect(page.getByText('Basalt To Delete')).toHaveCount(0);
});
