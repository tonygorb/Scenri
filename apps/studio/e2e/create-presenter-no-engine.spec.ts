import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * No drawing engine: describing someone answers with the way to set one up,
 * and photographs still become the presenter, saved as they are.
 */
isolate({ shot: false, env: { SCENRI_DEMO_ENGINE: '0', SCENRI_DEMO_BUILDS: '0' } });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

test('without an engine, describing offers the setup and photos still save', async ({ page }) => {
  test.setTimeout(60_000);
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/presenters/new`);
  const log = page.getByRole('log');
  await log.getByRole('button', { name: 'Describe someone' }).click();
  await expect(log).toContainText('needs image generation, which is not set up yet');
  await expect(log.getByRole('button', { name: 'Set up' })).toBeVisible();
  await expect(page.locator('.sc-pstudio-well img')).toHaveCount(0);

  await log.getByRole('button', { name: 'Add photos instead' }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'noor.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('checkbox').check();
  await log.getByRole('button', { name: 'Continue' }).click();
  await expect(log).toContainText('What should we call them?', { timeout: 20_000 });
  await page.locator('.sc-convo-card textarea').fill('Noor');
  await page.locator('.sc-convo-card textarea').press('Enter');
  await expect(log).toContainText('No engine here can draw the other views.');
  await log.getByRole('button', { name: 'Save with photos' }).click();
  await expect(page).toHaveURL(/\/presenters\/up-/, { timeout: 20_000 });
  const brands = await (await page.request.get('/api/brands')).json();
  const person = (brands.find((b: any) => b.id === brand.id).json.characters ?? []).find((c: any) => c.name === 'Noor');
  expect(person.source).toBe('photos');
  expect(person.sourceRefs).toHaveLength(1);
  expect(person.shots).toHaveLength(1);
  expect(person.shots[0].angle).toBe('portrait');
});
