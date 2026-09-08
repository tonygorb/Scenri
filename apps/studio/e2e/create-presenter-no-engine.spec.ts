import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * No drawing engine: From scratch shows the way to set one up, and From
 * photos still saves the photographs as the presenter.
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

test('without an engine, From scratch offers the setup and From photos still saves', async ({ page }) => {
  test.setTimeout(60_000);
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/presenters?new=presenter`);
  await expect(page.getByRole('tab', { name: 'From scratch' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Image generation is not set up yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set up' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create person' })).toHaveCount(0);
  await expect(page.locator('.sc-dlg-foot')).toContainText('Saved from the photos you add');

  await page.getByRole('tab', { name: 'From photos' }).click();
  await expect(page.getByText('No engine here can draw the other views')).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: 'noor.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Save with photos', exact: true }).click();

  const name = page.getByLabel('Name', { exact: true });
  await expect(name).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.sc-pstudio-status')).toContainText('Saved from your photos');
  await expect(page.getByLabel('What should change')).toHaveCount(0);
  await name.fill('Noor');
  await page.getByRole('button', { name: 'Save presenter' }).click();
  await expect(page.locator('.sc-newdlg')).toHaveCount(0, { timeout: 20_000 });
  const brands = await (await page.request.get('/api/brands')).json();
  const person = (brands.find((b: any) => b.id === brand.id).json.characters ?? []).find((c: any) => c.name === 'Noor');
  expect(person.source).toBe('photos');
  expect(person.sourceRefs).toHaveLength(1);
  expect(person.shots).toHaveLength(1);
});
