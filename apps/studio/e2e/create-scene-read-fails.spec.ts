import { expect, type Page, test } from '@playwright/test';
import { arrived, isolate } from './harness.js';

// Every read fails, the way a reader that ran out of quota fails: the studio
// says so in one line, draws nothing, saves nothing, and keeps the pictures.
isolate({
  env: {
    SCENRI_DEMO_BUILDS: '1',
    SCENRI_DEMO_ANALYSIS: 'usable',
    SCENRI_DEMO_FAIL_READ: '1',
    SCENRI_DEMO_READ_MS: '200',
  },
});

const A = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const studio = (p: Page) => p.locator('.sc-pstudio[data-kind="scene"]');
const turn = (p: Page, key: string) => studio(p).locator(`[data-turn="${key}"]`);

test('a read that fails is said once, draws nothing, saves nothing, and keeps the pictures', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(page.url()).pathname.split('/')[1]);
  await page.goto(`/${slug}/scenes/new`);
  await arrived(page, '.sc-pstudio[data-kind="scene"]');
  await turn(page, 'q:source').getByRole('button', { name: 'Add pictures', exact: true }).click();
  const q = turn(page, 'q:photos');
  await q.locator('input[type="file"]').setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: A }]);
  await expect(q.locator('.sc-assetform-ref img')).toHaveCount(1);
  await q.getByRole('button', { name: 'Read them', exact: true }).click();

  await expect(studio(page)).toContainText('That did not go through: demo: the read was refused. Nothing was drawn.');
  // nothing drawn and nothing saved
  await expect(studio(page).locator('[data-turn^="scenri:pic-"]')).toHaveCount(0);
  const brands = await (await page.request.get('/api/brands')).json();
  expect(brands.flatMap((b: any) => b.json?.scenes ?? [])).toEqual([]);
  // the pictures stay with the answer, so reading again needs nothing re-added
  await expect(turn(page, 'you:photos').locator('img')).toHaveCount(1);
});
