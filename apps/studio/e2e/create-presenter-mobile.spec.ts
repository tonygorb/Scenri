import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The conversation on a phone: one column, the stage held at the top, the
 * transcript scrolling under it to its newest turn, the composer at the
 * bottom above the keyboard. The tablet keeps the stage beside the rail.
 */
isolate({ env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5' } });

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

async function seedCandidate(p: Page, brandId: string): Promise<string> {
  const base = `/api/brands/${brandId}/presenter-drafts`;
  const draft = await (
    await p.request.post(base, { data: { source: 'synthetic', direction: 'a man in his 30s', name: 'Idan' } })
  ).json();
  await p.request.post(`${base}/${draft.id}/views/portrait/generate`, { data: {} });
  for (let i = 0; i < 200; i++) {
    const d = await (await p.request.get(`${base}/${draft.id}`)).json();
    if (d.views.portrait.status === 'candidate' && !d.activeView) break;
    await p.waitForTimeout(50);
  }
  return draft.id as string;
}

test('the phone stacks: stage held, newest turn in view, composer above the fold; the tablet keeps the rail', async ({
  page,
  isMobile,
}) => {
  const brand = await currentBrand(page);
  const draftId = await seedCandidate(page, brand.id);
  await page.goto(`/${brand.slug}/presenters/new/${draftId}`);
  // the iPad project reports itself as mobile; the layout is decided by width
  const phone = page.viewportSize()!.width < 768;
  void isMobile;
  const use = page.getByRole('log').getByRole('button', { name: 'Use this person' });
  await expect(use).toBeVisible({ timeout: 20_000 });
  const vw = page.viewportSize()!;
  const stage = await page.locator('.sc-pstudio-stage').boundingBox();
  const rail = await page.locator('.sc-pstudio-head').boundingBox();
  const decide = await use.boundingBox();
  const composer = await page.locator('.sc-convo-card').boundingBox();
  expect(stage && rail && decide && composer).toBeTruthy();
  // no horizontal overflow anywhere
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  if (phone) {
    // one column: the head above the stage, the decision and the composer both inside the viewport
    expect(rail!.y).toBeLessThan(stage!.y);
    expect(stage!.width).toBeGreaterThan(vw.width * 0.8);
    expect(decide!.y + decide!.height).toBeLessThanOrEqual(composer!.y + 1);
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(vw.height + 1);
    // the strip scrolls sideways rather than wrapping
    expect(await page.locator('.sc-pstudio-strip').evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
  } else {
    // the tablet keeps the stage beside the rail
    expect(stage!.x + stage!.width).toBeLessThanOrEqual(rail!.x + 1);
  }
});

test('the composer stays reachable with the keyboard up', async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, 'a phone concern');
  const brand = await currentBrand(page);
  const draftId = await seedCandidate(page, brand.id);
  await page.goto(`/${brand.slug}/presenters/new/${draftId}`);
  const field = page.locator('.sc-convo-card textarea');
  await expect(field).toBeVisible({ timeout: 20_000 });
  // the app's keyboard inset, as the visual viewport reports it
  await page.evaluate(() => document.documentElement.style.setProperty('--sc-kb', '300px'));
  await field.focus();
  const box = await field.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(box!.y + box!.height).toBeLessThanOrEqual(vh - 300 + 1);
  await expect(page.locator('.sc-pstudio-stage')).toBeVisible();
});
