import { expect, test } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * Photographs nobody could read.
 *
 * The read is codex, and the rest of the suite runs without it, so every
 * branch that turns on what the read made of the pictures was unreachable from
 * a spec. This file boots a server whose read rejects every photograph, which
 * is the case the studio acts on somebody's behalf: it stops rather than
 * spending a generation inventing a stranger, and asks what to do instead.
 */
isolate({ env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5', SCENRI_DEMO_ANALYSIS: 'unusable' } });

const log = (p: import('@playwright/test').Page) => p.getByRole('log');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('a read that can use none of them stops, says why, and draws nothing until it is told to', async ({ page }) => {
  test.setTimeout(90_000);
  const brands = (await (await page.request.get('/api/brands')).json()) as { id: string; slug: string }[];
  const brand = brands[0];
  await page.goto(`/${brand.slug}/presenters/new`);
  await log(page).getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles([
    { name: 'blurred.png', mimeType: 'image/png', buffer: png },
    { name: 'dark.png', mimeType: 'image/png', buffer: png },
  ]);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });

  // it says what is wrong in its own words, and offers the two ways on
  await expect(log(page)).toContainText('I cannot read a face in any of those photos', { timeout: 40_000 });
  const draftId = page.url().split('/').pop() as string;
  const draft = async () =>
    await (await page.request.get(`/api/brands/${brand.id}/presenter-drafts/${draftId}`)).json();

  // and nothing is drawn while the question stands
  await page.waitForTimeout(2500);
  expect((await draft()).views.portrait.status).toBe('empty');
  expect((await draft()).activeView).toBeNull();

  // told to draw anyway, it draws
  await log(page).getByRole('button', { name: 'Draw from these anyway', exact: true }).click();
  await expect.poll(async () => (await draft()).views.portrait.status, { timeout: 40_000 }).not.toBe('empty');
});

test('the other way on throws the draft away rather than keeping a person nobody can see', async ({ page }) => {
  test.setTimeout(90_000);
  const brands = (await (await page.request.get('/api/brands')).json()) as { id: string; slug: string }[];
  const brand = brands[0];
  await page.goto(`/${brand.slug}/presenters/new`);
  await log(page).getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'blurred.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });
  const draftId = page.url().split('/').pop() as string;
  await expect(log(page)).toContainText('I cannot read a face in any of those photos', { timeout: 40_000 });

  await log(page).getByRole('button', { name: 'Use different photos', exact: true }).click();
  // back at the first question, and this draft is gone rather than left behind
  await expect(log(page)).toContainText('Who are we making?', { timeout: 20_000 });
  const left = (await (await page.request.get(`/api/brands/${brand.id}/presenter-drafts`)).json()) as {
    drafts: { id: string }[];
  };
  expect(left.drafts.map((d) => d.id)).not.toContain(draftId);
});
