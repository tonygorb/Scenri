import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { arrived, isolate } from './harness.js';

/**
 * The editor holds still.
 *
 * Two complaints, one surface. Opening the editor used to write the record's
 * history out as four to six brand new lines, each waiting a beat for the one
 * before it, so the panel grew in steps while you watched. And while a view is
 * being drawn the draft is read again every 1500ms, which used to be a render
 * the reader could see.
 *
 * Both are measured here rather than described: the transcript's height is
 * sampled across the settle, and the browser's own layout-shift entries are
 * collected while a redraw runs.
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

async function settled(req: APIRequestContext, brandId: string, draftId: string, view: string, want: string) {
  for (let i = 0; i < 200; i++) {
    const d = await (await req.get(`/api/brands/${brandId}/presenter-drafts/${draftId}`)).json();
    if (d.views[view].status === want && !d.activeView) return d;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${view} never became ${want}`);
}

async function seedPresenter(req: APIRequestContext, brandId: string, name = 'Maren'): Promise<string> {
  const base = `/api/brands/${brandId}/presenter-drafts`;
  const draft = await (
    await req.post(base, { data: { source: 'synthetic', direction: 'a woman in her 30s', name } })
  ).json();
  for (const view of ['portrait', 'front']) {
    await req.post(`${base}/${draft.id}/views/${view}/generate`, { data: {} });
    await settled(req, brandId, draft.id, view, 'candidate');
    await req.post(`${base}/${draft.id}/views/${view}/approve`);
  }
  // The third completes the set, so the editor opens asking what to change
  // rather than offering to build what is missing.
  await req.post(`${base}/${draft.id}/views/three-quarter/generate`, { data: { decide: 'auto' } });
  await settled(req, brandId, draft.id, 'three-quarter', 'approved');
  const saved = await (await req.post(`${base}/${draft.id}/save`)).json();
  return saved.presenter.id as string;
}

/** Every layout shift the browser reports, from now until it is read back. */
async function watchShifts(p: Page) {
  await p.evaluate(() => {
    const w = window as unknown as { __shifts: number[] };
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        // A shift the reader caused by scrolling or clicking is not a jump.
        const s = e as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!s.hadRecentInput) w.__shifts.push(s.value);
      }
    }).observe({ type: 'layout-shift', buffered: false });
  });
}
const shifts = (p: Page) =>
  p.evaluate(() => (window as unknown as { __shifts: number[] }).__shifts.reduce((a, b) => a + b, 0));

test('the editor opens on the record already said, and the panel does not grow while you read it', async ({ page }) => {
  test.setTimeout(60_000);
  const brand = await currentBrand(page);
  const id = await seedPresenter(page.request, brand.id, 'Steady');

  await page.goto(`/${brand.slug}/presenters/${id}/edit`);
  const log = page.getByRole('log');
  await expect(log).toBeVisible();

  // Once the surface has landed. It arrives with the house motion now, and a
  // 2% zoom settling is the surface travelling, not the transcript growing,
  // which is the only thing this test is about.
  await arrived(page);

  // The record's own lines are there to be read, not delivered one at a time.
  const heights: number[] = [];
  for (let i = 0; i < 12; i++) {
    heights.push(await log.evaluate((el) => Math.round(el.getBoundingClientRect().height)));
    await page.waitForTimeout(120);
  }
  const settledHeight = heights[heights.length - 1];
  expect(settledHeight).toBeGreaterThan(0);
  // Every sample after the first paint is already the height it ends at: the
  // transcript is not still arriving a line at a time.
  expect(heights.filter((h) => h !== settledHeight)).toHaveLength(0);
});

test('a view being drawn is read again every beat without moving what is on screen', async ({ page }) => {
  test.setTimeout(60_000);
  const brand = await currentBrand(page);
  const id = await seedPresenter(page.request, brand.id, 'Placid');

  await page.goto(`/${brand.slug}/presenters/${id}/edit`);
  // The editor asks before it offers a composer, so wait for the question.
  await expect(page.getByRole('log')).toContainText('What would you like to change about Placid?');

  // Ask for a redraw, then hold still and watch.
  const composer = page.locator('.sc-convo-card textarea');
  await composer.fill('make the hair a little shorter');
  await watchShifts(page);
  await composer.press('Enter');

  // Long enough for several of the 1500ms reads of the draft.
  await page.waitForTimeout(6000);
  const moved = await shifts(page);
  // A conversation that answers moves on purpose; what it must not do is
  // twitch on every poll. Anything above this is a visible jump.
  expect(moved).toBeLessThan(0.1);
});

test('the picture being asked about is in the conversation, on a phone too', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await currentBrand(page);
  const id = await seedPresenter(page.request, brand.id, 'Shown');

  // the phone has no stage at all, so the conversation is the only place a
  // candidate can be looked at
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${brand.slug}/presenters/${id}/edit`);
  await expect(page.getByRole('log')).toContainText('What would you like to change about Shown?');
  expect(await page.locator('.sc-pstudio-stage').isVisible()).toBe(false);

  const composer = page.locator('.sc-convo-card textarea');
  await composer.fill('make the hair shorter');
  await composer.press('Enter');

  // The question about the redraw stands, and the redraw stands with it. The
  // picture has to be the candidate's own turn: asserting "an image somewhere
  // in the log" passed while this was broken, because the views drawn earlier
  // were still there above it.
  await expect(page.getByRole('log')).toContainText('with the change', { timeout: 40_000 });
  const candidate = page.locator('[data-turn^="scenri:candidate-portrait-"]');
  await expect(candidate).toHaveCount(1);
  await expect(candidate).toContainText('with the change');
  const shot = candidate.locator('img');
  await expect(shot).toBeVisible();
  expect(await shot.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  // and what was asked is said once, not twice
  expect(await page.getByRole('log').getByText('make the hair shorter').count()).toBe(1);
});
