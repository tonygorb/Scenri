import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The presenter studio on a hand's width, and on a tablet.
 *
 * The studio is the whole screen at every width. Above 768px the stage is
 * left and the rail right; below it the same markup stacks into one column:
 * head, the two ways to start, the picture, the strip, the words, and a
 * bottom that stays put with the composer and the one decision in it. Runs
 * on the mobile (Pixel 5) and tablet (iPad Mini landscape) projects.
 */
isolate({ env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5' } });

const isPhone = (p: Page) => (p.viewportSize()?.width ?? 0) < 768;
const studio = (p: Page) => p.locator('.sc-pstudio');

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

/** Wait until a box stops moving, so a measure is of a settled layout. */
async function settledBox(p: Page, selector: string) {
  let last = '';
  for (let i = 0; i < 40; i++) {
    const box = await p.locator(selector).evaluate((el) => JSON.stringify(el.getBoundingClientRect()));
    if (box === last) return;
    last = box;
    await p.waitForTimeout(60);
  }
}

async function seedFace(p: Page, brandId: string): Promise<string> {
  const base = `/api/brands/${brandId}/presenter-drafts`;
  const draft = await (
    await p.request.post(base, { data: { source: 'synthetic', direction: 'a man in his 30s' } })
  ).json();
  await p.request.post(`${base}/${draft.id}/views/portrait/generate`, { data: {} });
  for (let i = 0; i < 200; i++) {
    const d = await (await p.request.get(`${base}/${draft.id}`)).json();
    if (d.views.portrait.status === 'candidate' && !d.activeView) break;
    await p.waitForTimeout(50);
  }
  return draft.id as string;
}

async function openDraft(p: Page, brand: { slug: string; id: string }, draftId: string) {
  await p.goto(`/${brand.slug}/presenters`);
  await p.evaluate(({ id, brandId }) => sessionStorage.setItem(`scenri:presenter-draft:${brandId}`, id), {
    id: draftId,
    brandId: brand.id,
  });
  await p.goto(`/${brand.slug}/presenters/new`);
}

test('the studio is the whole screen; the phone stacks it, the tablet keeps the stage', async ({ page }) => {
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/presenters/new`);
  await expect(studio(page)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'From scratch' })).toBeVisible();
  await settledBox(page, '.sc-pstudio');

  const g = await studio(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      viewportH: window.innerHeight,
      viewportW: window.innerWidth,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      stageShown: getComputedStyle(document.querySelector('.sc-pstudio-stage')!).display !== 'none',
    };
  });
  expect(g.overflow).toBeLessThanOrEqual(1);
  // a place, not a sheet: edge to edge at every width
  expect(Math.abs(g.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(g.bottom - g.viewportH)).toBeLessThanOrEqual(1);
  expect(Math.abs(g.width - g.viewportW)).toBeLessThanOrEqual(1);
  // nothing to look at yet: the phone gives the words the room
  expect(g.stageShown).toBe(!isPhone(page));
});

test('the picture, the strip and the decision all fit, and the strip scrolls sideways', async ({ page }) => {
  const brand = await currentBrand(page);
  const draftId = await seedFace(page, brand.id);
  await openDraft(page, brand, draftId);
  const use = page.getByRole('button', { name: 'Use this person' });
  await expect(use).toBeVisible({ timeout: 20_000 });
  await settledBox(page, '.sc-pstudio');
  await expect(page.locator('.sc-pstudio-well img')).toBeVisible();
  await expect(page.locator('.sc-pstudio-slot')).toHaveCount(5);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const box = await use.boundingBox();
  // 44 is the touch floor on a phone; the card keeps the app's 34px button (33.98 on WebKit)
  expect(box!.height).toBeGreaterThanOrEqual(isPhone(page) ? 44 : 33);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  if (isPhone(page)) {
    const strip = await page.locator('.sc-pstudio-strip').evaluate((el) => getComputedStyle(el).overflowX);
    expect(strip).toBe('auto');
  }
});

test('the decision stays reachable with the composer focused', async ({ page }) => {
  test.skip(!isPhone(page), 'no software keyboard to clear above the breakpoint');
  const brand = await currentBrand(page);
  const draftId = await seedFace(page, brand.id);
  await openDraft(page, brand, draftId);
  const use = page.getByRole('button', { name: 'Use this person' });
  await expect(use).toBeVisible({ timeout: 20_000 });
  await settledBox(page, '.sc-pstudio');
  await page.getByLabel('What should change').tap();
  const box = await use.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});
