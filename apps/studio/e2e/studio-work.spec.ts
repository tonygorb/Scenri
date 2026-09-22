import { expect, type Locator, type Page, test } from '@playwright/test';
import { arrived, isolate } from './harness.js';
import { finishSceneSet, mainNav } from './realtime.js';

/**
 * Studio work is the server's, not the page's.
 *
 * A scene or a presenter's views are drawn on the server; the studio only
 * watches. So a person can start a draw, go anywhere in the app, and come back
 * (by Back, or from Activity) to the same conversation with the result on it;
 * Stop stops it and always leaves a way on; and the bell says what finished
 * only where the page on screen did not already say it.
 *
 * Draws and reads take real time here (SCENRI_DEMO_DELAY_MS, SCENRI_DEMO_READ_MS)
 * because those seconds are where every one of these states lives.
 */
isolate({
  env: {
    SCENRI_DEMO_BUILDS: '1',
    SCENRI_DEMO_REFS: '5',
    SCENRI_DEMO_DELAY_MS: '4000',
    SCENRI_DEMO_ANALYSIS: 'usable',
    SCENRI_DEMO_READ_MS: '2500',
  },
});

async function brandSlug(p: Page): Promise<string> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  return decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
}

const studio = (p: Page) => p.locator('.sc-pstudio');
const line = (p: Page) => p.locator('.sc-convo-card textarea');
const pill = (p: Page) => p.locator('.sc-convo-send');
/** The live question, never the ghost of the one just answered. */
const openQ = (p: Page) => studio(p).locator('[data-turn^="q:"]:not([data-picked])').last();
const toast = (p: Page, text: string) => p.locator('.sc-toast', { hasText: text });

async function say(p: Page, text: string) {
  await line(p).fill(text);
  await line(p).press('Enter');
}

async function tap(q: Locator, name: string) {
  await q.getByRole('button', { name, exact: true }).click();
}

/** A scene studio with a place said in full, read back and ready to draw. */
async function readyToDraw(p: Page, slug: string, sentence: string) {
  await p.goto(`/${slug}/scenes/new`);
  await arrived(p, '.sc-pstudio[data-kind="scene"]');
  await p.waitForURL(new RegExp(`/${slug}/scenes/new/[a-f0-9]+$`));
  await say(p, sentence);
  await expect(openQ(p)).toHaveAttribute('data-turn', /^q:agree-/, { timeout: 15_000 });
  return new URL(p.url()).pathname;
}

/** Count the studio's starts by kind, from the requests the page sends. */
function starts(p: Page) {
  const seen: string[] = [];
  p.on('request', (r) => {
    if (r.method() === 'POST' && /\/scene-studio\/jobs$/.test(r.url()))
      seen.push(JSON.parse(r.postData() ?? '{}').kind);
  });
  return seen;
}

test('a scene draw goes on while you are elsewhere, and Activity brings you back to it', async ({ page }) => {
  const slug = await brandSlug(page);
  const sent = starts(page);
  const at = await readyToDraw(page, slug, 'A white cyclorama under hard flash, seen straight on, on a low plinth');
  await tap(openQ(page), 'Draw the scene');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:name');
  await say(page, 'Flash Cyc');

  // Close while it draws: nothing to ask, the work goes on without the page
  await studio(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(studio(page)).toHaveCount(0);

  // the bell has it, running, by the name it was given, saying what it is doing
  await page.locator('.sc-topbar .sc-notif-btn').click();
  const row = page.locator('.sc-notif-scroll .sc-notif-row', { hasText: 'Flash Cyc' });
  await expect(row).toContainText('Drawing the picture');
  await page.keyboard.press('Escape');

  // and away through the app, the way a person would wander off
  for (const name of ['Home', 'Products', 'Presenters', 'Scenes', 'Create']) {
    await mainNav(page).getByRole('link', { name, exact: true }).click();
  }

  // it finishes out of sight: one card that names it and leads back
  const done = toast(page, 'Flash Cyc is drawn');
  await expect(done).toBeVisible({ timeout: 20_000 });
  await done.getByRole('button', { name: 'Open' }).click();
  await page.waitForURL((u) => u.pathname === at);
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/);
  await expect(studio(page).locator('.sc-pstudio-well img')).toHaveCount(1);

  // one draw, one read: the walk never started or repeated anything
  expect(sent.filter((k) => k === 'again')).toHaveLength(1);
  expect(sent.filter((k) => k === 'make')).toHaveLength(1);
});

test('a finish on the studio page itself is said on the stage, and nowhere else', async ({ page }) => {
  test.setTimeout(45_000);
  const slug = await brandSlug(page);
  await readyToDraw(page, slug, 'A white cyclorama under hard flash, seen straight on, on a low plinth');
  await tap(openQ(page), 'Draw the scene');
  await say(page, 'Stage Only');
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/, { timeout: 20_000 });
  // give the bell a poll or two to have had its chance
  await page.waitForTimeout(2500);
  await expect(toast(page, 'Stage Only')).toHaveCount(0);
});

test('Stop is in reach while the name is asked, stops the draw, and Draw finishes it after', async ({ page }) => {
  const slug = await brandSlug(page);
  const at = await readyToDraw(page, slug, 'A white cyclorama under hard flash, seen straight on, on a low plinth');
  await tap(openQ(page), 'Draw the scene');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:name');
  // the line is the name's, and while it is empty the pill is Stop
  await expect(pill(page)).toHaveText('Stop');
  await line(page).fill('Half');
  await expect(pill(page)).toHaveText('Send');
  await line(page).fill('');
  await pill(page).click();
  await expect(studio(page)).toContainText('Stopped. Nothing was drawn.');
  // the words stand and the way on is the same press as before
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:agree-/);
  await expect(studio(page).locator('.sc-pstudio-well img')).toHaveCount(0);

  // a reload finds it exactly there, and starts nothing by itself
  const sent = starts(page);
  await page.reload();
  await page.waitForURL((u) => u.pathname === at);
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:agree-/);
  await page.waitForTimeout(1500);
  expect(sent).toHaveLength(0);

  await tap(openQ(page), 'Draw the scene');
  await say(page, 'Second Go');
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/, { timeout: 20_000 });
  await expect(studio(page).locator('.sc-pstudio-well img')).toHaveCount(1);
});

test('a stopped read asks, and does not read again on its own after a reload', async ({ page }) => {
  const slug = await brandSlug(page);
  await page.goto(`/${slug}/scenes/new`);
  await arrived(page, '.sc-pstudio[data-kind="scene"]');
  const sent = starts(page);
  await say(page, 'A white cyclorama under hard flash, seen straight on, on a low plinth');
  await expect(pill(page)).toHaveText('Stop');
  await pill(page).click();
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:retry');
  await expect(openQ(page)).toContainText('Stopped before the place was read.');
  expect(sent.filter((k) => k === 'make')).toHaveLength(1);

  await page.reload();
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:retry');
  await page.waitForTimeout(3500);
  expect(sent.filter((k) => k === 'make')).toHaveLength(1);

  // asked, it reads
  await tap(openQ(page), 'Try again');
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:agree-/, { timeout: 15_000 });
});

test('a presenter face can be stopped while its name is asked, and drawn again', async ({ page }) => {
  const slug = await brandSlug(page);
  await page.goto(`/${slug}/presenters/new`);
  await arrived(page);
  await say(page, 'Late 30s woman, Mediterranean appearance, dark shoulder-length hair, slim build, elegant.');
  await page.getByRole('log').getByRole('button', { name: 'Nothing else', exact: true }).click();
  // the face draws on its own, and the name is asked while it does
  await expect(pill(page)).toHaveText('Stop', { timeout: 15_000 });
  await pill(page).click();
  const log = page.getByRole('log');
  await expect(log).toContainText('Stopped drawing the face. Nothing finished was touched.');
  await log.getByRole('button', { name: 'Draw it again', exact: true }).click();
  await expect(log.getByRole('button', { name: 'Use this person', exact: true })).toBeVisible({ timeout: 20_000 });
});

test('a presenter set goes on after the studio closes, and the bell says so once', async ({ page }) => {
  test.setTimeout(90_000);
  const slug = await brandSlug(page);
  const brands = await (await page.request.get('/api/brands')).json();
  const brandId = brands.find((b: { slug: string }) => b.slug === slug).id as string;
  const base = `/api/brands/${brandId}/presenter-drafts`;
  const settle = async (id: string, view: string, want: string) => {
    for (let i = 0; i < 300; i++) {
      const d = await (await page.request.get(`${base}/${id}`)).json();
      if (d.views[view].status === want && !d.activeView) return d;
      await page.waitForTimeout(100);
    }
    throw new Error(`${view} never became ${want}`);
  };
  // the two views a person decides, decided, and the extras asked for
  const draft = await (
    await page.request.post(base, { data: { source: 'synthetic', direction: 'a man in his 30s', name: 'Away Set' } })
  ).json();
  await page.request.patch(`${base}/${draft.id}`, { data: { extras: true } });
  for (const view of ['portrait', 'front']) {
    await page.request.post(`${base}/${draft.id}/views/${view}/generate`, { data: {} });
    await settle(draft.id, view, 'candidate');
    await page.request.post(`${base}/${draft.id}/views/${view}/approve`);
  }
  // the studio starts the part of the set that decides itself; then the person leaves
  await page.goto(`/${slug}/presenters/new/${draft.id}`);
  await arrived(page);
  await expect
    .poll(async () => (await (await page.request.get(`${base}/${draft.id}`)).json()).activeView, { timeout: 15_000 })
    .toBe('three-quarter');
  await studio(page).getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(studio(page)).toHaveCount(0);

  // the server carries it view after view, and one card says so when it is all done
  const card = toast(page, 'Away Set is drawn');
  await expect(card).toBeVisible({ timeout: 60_000 });
  const d = await (await page.request.get(`${base}/${draft.id}`)).json();
  for (const view of ['three-quarter', 'back', 'left', 'right']) expect(d.views[view].status).toBe('approved');
  await expect(toast(page, 'Away Set')).toHaveCount(1);
});

test('a scene closed while it draws stays on the Scenes wall, drawing, then drawn, and opens where it was left', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const slug = await brandSlug(page);
  const at = await readyToDraw(page, slug, 'A white cyclorama under hard flash, seen straight on, on a low plinth');
  await tap(openQ(page), 'Draw the scene');
  await say(page, 'Wall Cyc');
  await studio(page).getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForURL(new RegExp(`/${slug}/scenes$`));

  // first on the wall, marked as a draft, and saying it is drawing
  const card = page.locator('.sc-lookcard[data-build]', { hasText: 'Wall Cyc' });
  await expect(card).toContainText('Drawing');
  await expect(card).toHaveAttribute('data-building', 'true');
  await expect(card.locator('.sc-draftmark')).toHaveText('Draft');

  // the draw lands with nobody in the studio: the card becomes the picture
  await expect(card).toContainText('Drawn, not used yet', { timeout: 20_000 });
  await expect(card.locator('img')).toHaveCount(1);

  // and it opens the conversation it came from, the picture on its stage
  await card.getByRole('link', { name: 'Continue Wall Cyc' }).click();
  await page.waitForURL((u) => u.pathname === at);
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/);
  await tap(openQ(page), 'Use this scene');
  // the conversation goes on to the place in use, and ends on one press
  await finishSceneSet(page);
  await page.waitForURL(/\/scenes\/us-/);

  // used, it is a scene of its own and no longer a draft
  await page.goto(`/${slug}/scenes`);
  await expect(page.locator('.sc-lookcard[data-build]', { hasText: 'Wall Cyc' })).toHaveCount(0);
});
