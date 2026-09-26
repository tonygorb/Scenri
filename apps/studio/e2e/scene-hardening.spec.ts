import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { arrived, isolate } from './harness.js';
import { brandJson, currentBrand, goScenes, holdNext, uploadPng } from './realtime.js';

/**
 * The scene studio and the scene page where the behaviour lives in the
 * browser: a press whose request is still on its way, a read that fails once,
 * Enter with nothing focused, a reload or a second tab in the middle, and how
 * the work is announced once the person has left. The demo engine reads and
 * draws, slowly enough that the states a person sits in while work runs exist.
 * Every test starts its own conversation, under a name of its own.
 */
isolate({
  env: {
    SCENRI_DEMO_BUILDS: '1',
    SCENRI_DEMO_REFS: '5',
    SCENRI_DEMO_DELAY_MS: '1200',
    SCENRI_DEMO_ANALYSIS: 'usable',
    SCENRI_DEMO_READ_MS: '300',
  },
  library: true,
});

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const EXAMPLES = /\/api\/brands\/[^/]+\/scenes\/[^/]+\/examples$/;
const START = /\/api\/brands\/[^/]+\/scene-studio\/jobs$/;

const studio = (p: Page) => p.locator('.sc-pstudio[data-kind="scene"]');
const turn = (p: Page, key: string) => studio(p).locator(`[data-turn="${key}"]`);
const openQ = (p: Page) => studio(p).locator('[data-turn^="q:"]').last();
const live = (p: Page) => studio(p).locator('[data-turn^="q:"]:not([data-picked])').last();
/** The question on the floor: not a ghost of one just answered, not one leaving. */
const floorQ = (p: Page) => studio(p).locator('[data-turn^="q:"]:not([data-picked]):not([data-leave])').last();
const line = (p: Page) => studio(p).locator('.sc-pstudio-foot textarea');
const pill = (p: Page) => studio(p).locator('.sc-convo-send');

async function say(p: Page, text: string) {
  await line(p).fill(text);
  await line(p).press('Enter');
}

async function tap(q: Locator, name: string) {
  await q.getByRole('button', { name, exact: true }).click();
}

/** A new scene conversation, on its first question. */
async function start(p: Page): Promise<string> {
  const { slug } = await currentBrand(p);
  await p.goto(`/${slug}/scenes/new`);
  await arrived(p, '.sc-pstudio[data-kind="scene"]');
  await expect(turn(p, 'q:source')).toBeVisible();
  return slug;
}

/** A place said in one sentence, every follow-up left to the reading, up to the read-back. */
async function place(p: Page, sentence: string) {
  await say(p, sentence);
  let passed = '';
  for (let i = 0; i < 5; i++) {
    const q = live(p);
    if (passed) await expect(q).not.toHaveAttribute('data-turn', passed, { timeout: 30_000 });
    await expect(q).toHaveAttribute('data-turn', /^q:(world|surface|light|signature|agree-|decide-|name)/, {
      timeout: 30_000,
    });
    const id = (await q.getAttribute('data-turn')) ?? '';
    if (!/^q:(world|surface|light|signature)$/.test(id)) break;
    await tap(q, 'Leave it to the reading');
    passed = id;
  }
  await expect(openQ(p)).toHaveAttribute('data-turn', /^q:agree-/, { timeout: 30_000 });
}

/** The guided answers, up to the read-back. */
async function guide(p: Page) {
  await tap(turn(p, 'q:source'), 'Guide me');
  for (const [id, pick] of [
    ['world', 'Sunlit stone'],
    ['surface', 'Travertine'],
    ['light', 'Low golden sun'],
    ['signature', 'Vines taking over'],
  ]) {
    await expect(turn(p, `q:${id}`)).toBeVisible();
    await tap(turn(p, `q:${id}`), pick);
  }
  await expect(openQ(p)).toContainText('What your shots are told');
}

async function draw(p: Page) {
  const agree = openQ(p);
  await expect(agree).toContainText('What your shots are told');
  await tap(agree, 'Draw the scene');
}

/** Drawn and named: the decide question on the floor. */
async function named(p: Page, name: string) {
  await say(p, name);
  await expect(openQ(p)).toHaveAttribute('data-turn', /^q:decide-/, { timeout: 45_000 });
}

/** The saved scene by name. Use answers before a loaded machine has always read it back, so this waits for it. */
async function sceneRef(p: Page, name: string) {
  for (let i = 0; i < 50; i++) {
    const brands = await (await p.request.get('/api/brands')).json();
    for (const b of brands) {
      const s = (b.json?.scenes ?? []).find((x: any) => x.name === name);
      if (s) return { brandId: b.id as string, sceneId: s.id as string, scene: s };
    }
    await p.waitForTimeout(200);
  }
  throw new Error(`no scene called ${name}`);
}

async function scenesNamed(p: Page, name: string): Promise<number> {
  const brands = await (await p.request.get('/api/brands')).json();
  return brands.flatMap((b: any) => b.json?.scenes ?? []).filter((x: any) => x.name === name).length;
}

async function exJob(p: Page, r: { brandId: string; sceneId: string }) {
  return (await (await p.request.get(`/api/brands/${r.brandId}/scenes/${r.sceneId}/examples`)).json()).job;
}

/** A scene read, drawn, named and used: the conversation on the offer of the place in use. */
async function toSetStart(p: Page, sentence: string, name: string) {
  const slug = await start(p);
  await place(p, sentence);
  await draw(p);
  await named(p, name);
  await tap(openQ(p), 'Use this scene');
  await expect(openQ(p)).toHaveAttribute('data-turn', 'q:set-start', { timeout: 30_000 });
  return { slug, ...(await sceneRef(p, name)) };
}

/** Every toast that appears from now on, by its text, however briefly it stays. */
async function recordToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __toasts: string[] };
    w.__toasts = [];
    const seen = new WeakSet<Element>();
    const scan = () => {
      for (const el of document.querySelectorAll('.sc-toast')) {
        if (seen.has(el)) continue;
        seen.add(el);
        w.__toasts.push((el.textContent ?? '').replace(/\s+/g, ' ').trim());
      }
    };
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    scan();
  });
}
const toastsSeen = (page: Page) => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts);

test.describe('a press still on its way', () => {
  test('Enter with nothing focused does not start a draw at the read-back (SC-H3)', async ({ page }) => {
    await start(page);
    await place(page, 'A sunlit loft with brick walls');
    // a click on the words of the conversation, then Enter
    await studio(page).locator('.sc-convo-say').first().click();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    await expect(studio(page).locator('[data-turn^="you:pending-"]')).toHaveCount(0);
    await expect(live(page)).toHaveAttribute('data-turn', /^q:agree-/);
  });

  test('no other offer is live while "Draw it" is on its way (SC-H4)', async ({ page }) => {
    test.setTimeout(150_000);
    await toSetStart(page, 'A white tiled niche with a brass tap', 'Brass Niche H4');
    const held = await holdNext(page, EXAMPLES, 'POST');
    await tap(openQ(page), 'Draw it');
    await held.caught;
    const early = studio(page).locator(
      '[data-turn="q:set-more"]:not([data-picked]), [data-turn="q:set-done"]:not([data-picked])',
    );
    await page.waitForTimeout(2000);
    await expect(early).toHaveCount(0);
    held.release();
    await expect(openQ(page)).toHaveAttribute('data-turn', 'q:set-more', { timeout: 60_000 });
  });

  test('an answer changed while Try again is being sent is still read (SC-H12)', async ({ page }) => {
    test.setTimeout(120_000);
    await start(page);
    await guide(page);
    await draw(page);
    await named(page, 'Stone Hall H12');
    const held = await holdNext(page, START, 'POST');
    await tap(openQ(page), 'Try again');
    await held.caught;
    // the pencil is live while the start is in flight
    await turn(page, 'you:signature').hover();
    await turn(page, 'you:signature').getByRole('button', { name: 'Change this answer' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Change it' }).click();
    await tap(turn(page, 'q:signature'), 'Dust in the sun');
    held.release();
    // the draw that was already on its way lands, and the answers changed meanwhile are read
    await expect(turn(page, 'scenri:pic-0')).toBeVisible({ timeout: 45_000 });
    await expect(floorQ(page)).toContainText('dust', { timeout: 30_000 });
  });

  test('a draw pressed just before a reload lands in the conversation it was pressed in (SC2-X2)', async ({ page }) => {
    test.setTimeout(90_000);
    await start(page);
    await guide(page);
    const held = await holdNext(page, START, 'POST');
    await tap(openQ(page), 'Draw the scene');
    // the server has the draw; its answer has not reached the page when the page goes
    await held.caught;
    await page.reload();
    await arrived(page, '.sc-pstudio[data-kind="scene"]');
    await expect(studio(page).locator('[data-turn^="scenri:pic-"]')).toHaveCount(1, { timeout: 30_000 });
  });

  test('a Use whose answer was lost, pressed again, saves one scene (SS-H15)', async ({ page }) => {
    test.setTimeout(90_000);
    await start(page);
    await guide(page);
    await draw(page);
    await named(page, 'Lost Lobby');
    // the first Use reaches the server and is saved there; its answer is lost on the way back
    let lost = false;
    await page.route(/\/api\/brands\/[^/]+\/scenes$/, async (route) => {
      if (lost || route.request().method() !== 'POST') return route.fallback();
      lost = true;
      await route.fetch();
      await route.abort('connectionreset');
    });
    await tap(openQ(page), 'Use this scene');
    await expect.poll(() => scenesNamed(page, 'Lost Lobby')).toBe(1);
    // the studio says it did not work and offers Use again
    const use = openQ(page).getByRole('button', { name: 'Use this scene', exact: true });
    await expect(use).toBeEnabled({ timeout: 10_000 });
    await use.click();
    await expect(turn(page, 'scenri:saved')).toBeVisible({ timeout: 15_000 });
    expect(await scenesNamed(page, 'Lost Lobby')).toBe(1);
  });

  test('closing the studio while Use is saving leaves no draft of the saved scene (SC1-X1)', async ({ page }) => {
    test.setTimeout(120_000);
    const slug = await start(page);
    const convo = new URL(page.url()).pathname.split('/').pop() as string;
    await place(page, 'A white limestone plinth in a gallery');
    await draw(page);
    await named(page, 'Plinth X1');
    const held = await holdNext(page, /\/api\/brands\/[^/]+\/scenes$/, 'POST');
    await tap(openQ(page), 'Use this scene');
    await held.caught;
    await line(page).focus();
    await page.keyboard.press('Escape');
    held.release();
    await page.waitForURL(new RegExp(`/${slug}/scenes`));
    await page.waitForTimeout(1500);
    expect(await scenesNamed(page, 'Plinth X1')).toBe(1);
    await expect(page.locator(`.sc-lookcard[data-build]:has(a[href$="${convo}"])`)).toHaveCount(0);
  });

  test('Shoot it this way does not pull the person back after they left the page (SC-H14)', async ({ page }) => {
    test.setTimeout(120_000);
    const slug = await start(page);
    await guide(page);
    await draw(page);
    await named(page, 'Way Hall H14');
    await tap(openQ(page), 'Use this scene');
    await expect(floorQ(page)).toHaveAttribute('data-turn', 'q:set-start', { timeout: 30_000 });
    await tap(floorQ(page), 'Draw it');
    await expect(floorQ(page)).toHaveAttribute('data-turn', /^q:set-(more|done)$/, { timeout: 60_000 });
    if ((await floorQ(page).getAttribute('data-turn')) === 'q:set-more') await tap(floorQ(page), 'Not now');
    await tap(floorQ(page), 'Open scene');
    await page.waitForURL(new RegExp(`/${slug}/scenes/us-[^/]+$`));
    await page
      .getByRole('button', { name: /^Close-up.*, open$/ })
      .first()
      .click({ position: { x: 8, y: 8 } });
    const held = await holdNext(page, /\/api\/brands\/[^/]+\/scenes\/us-[^/]+$/, 'PATCH');
    await page.getByRole('button', { name: 'Shoot it this way' }).click();
    await held.caught;
    // they change their mind and go on to Products
    await page.keyboard.press('Escape');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Products', exact: true }).click();
    await page.waitForURL(new RegExp(`/${slug}/products$`));
    held.release();
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(new RegExp(`/${slug}/products$`));
  });
});

test.describe('the answers and the pictures', () => {
  test('pictures attached while the source is open again drop the pictures drawn from the old answers (SC-H9)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await start(page);
    await guide(page);
    await draw(page);
    await named(page, 'Stone Niche H9');
    const pics = studio(page).locator('[data-turn^="scenri:pic-"]');
    await expect(pics).toHaveCount(1);
    await turn(page, 'you:source').hover();
    await turn(page, 'you:source').getByRole('button', { name: 'Change this answer' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('the pictures so far go');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Change it' }).click();
    await expect(turn(page, 'q:source')).toHaveAttribute('data-reopened', 'true');
    // a picture handed over through the line's own +, not the Add pictures choice
    await studio(page)
      .locator('.sc-pstudio-foot input[type="file"]')
      .setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: PIXEL }]);
    const q = turn(page, 'q:photos');
    await expect(q.locator('.sc-assetform-ref img')).toHaveCount(1);
    await tap(q, 'Read them');
    await expect(openQ(page)).toHaveAttribute('data-turn', /^q:agree-/, { timeout: 30_000 });
    // what the dialog promised: the pictures drawn from the old answers are gone
    await expect(pics).toHaveCount(0);
    await expect(studio(page).getByRole('button', { name: 'Put back' })).toHaveCount(0);
  });
});

test.describe('two tabs, and a second browser', () => {
  test('a second browser on the same conversation reads its own words, not the running job (SC-H7)', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    await start(page);
    const url = page.url();
    // browser B, no stored conversation, on the same address: answers up to the last row
    const other = await (browser as Browser).newContext({ baseURL: new URL(url).origin });
    const pb = await other.newPage();
    await pb.goto(url);
    await arrived(pb, '.sc-pstudio[data-kind="scene"]');
    await tap(turn(pb, 'q:source'), 'Guide me');
    for (const [id, pick] of [
      ['world', 'Dark mirror'],
      ['surface', 'Brushed steel'],
      ['light', 'Pool of light'],
    ]) {
      await expect(turn(pb, `q:${id}`)).toBeVisible();
      await tap(turn(pb, `q:${id}`), pick);
    }
    await expect(turn(pb, 'q:signature')).toBeVisible();
    // browser A draws its own place
    await place(page, 'A pale travertine counter by a tall window');
    await draw(page);
    await expect(pill(page)).toHaveText('Stop');
    // browser B finishes its answers: its read must be of its own place
    await tap(turn(pb, 'q:signature'), 'Wax cascading');
    await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/, { timeout: 45_000 });
    await expect(openQ(pb)).toHaveAttribute('data-turn', /^q:(agree-|decide-|retry)/, { timeout: 45_000 });
    await expect(openQ(pb)).not.toContainText('travertine');
    await expect(studio(pb).locator('.sc-pstudio-well img')).toHaveCount(0);
    await other.close();
  });

  test('a draft discarded on the wall stays gone while its studio is open in another tab (SC-H8)', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const slug = await start(page);
    const convo = new URL(page.url()).pathname.split('/').pop() as string;
    await place(page, 'A misty pine forest at dawn');
    await draw(page);
    await expect(pill(page)).toHaveText('Stop');
    const wall = await context.newPage();
    await wall.goto(`/${slug}/scenes`);
    const card = wall.locator(`.sc-lookcard[data-build]:has(a[href$="${convo}"])`);
    await expect(card).toBeVisible();
    await card.hover();
    await card.locator('.sc-cardpuck').click();
    await wall.getByRole('alertdialog').getByRole('button', { name: 'Discard', exact: true }).click();
    // the draft goes once its draw has heard the Stop, which a loaded machine takes a while to say
    await expect(card).toHaveCount(0, { timeout: 20_000 });
    // the studio tab hears its job stopped
    await expect(studio(page)).toContainText(/Stopped|stopped/, { timeout: 15_000 });
    // the wall, read again: the discarded draft is not back
    await wall.reload();
    await expect(wall.locator('.sc-owned, .sc-lookcard').first()).toBeVisible();
    await expect(wall.locator(`.sc-lookcard[data-build]:has(a[href$="${convo}"])`)).toHaveCount(0);
  });
});

test.describe('leaving, and what is said afterwards', () => {
  test('Back after opening and closing the studio leaves the Scenes wall (SC-H15)', async ({ page }) => {
    const { slug } = await currentBrand(page);
    await goScenes(page);
    await page.locator('.sc-new-go').click();
    await page.waitForURL(new RegExp(`/${slug}/scenes/new/[a-f0-9]+$`));
    await arrived(page, '.sc-pstudio[data-kind="scene"]');
    await expect(turn(page, 'q:source')).toBeVisible();
    await studio(page).getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForURL(new RegExp(`/${slug}/scenes$`));
    await page.goBack();
    // one Back from the wall goes to where the wall was opened from, not to the wall again
    await expect(page).toHaveURL(new RegExp(`/${slug}$`));
  });

  test('a used conversation whose scene was deleted does not announce it saved (SC-H16)', async ({ page }) => {
    test.setTimeout(90_000);
    const slug = await start(page);
    await guide(page);
    await draw(page);
    await named(page, 'Gone Hall');
    const at = new URL(page.url()).pathname;
    await tap(openQ(page), 'Use this scene');
    await expect(live(page)).toHaveAttribute('data-turn', /^q:set-/, { timeout: 30_000 });
    const brand = await currentBrand(page);
    const scene = ((await brandJson(page.request, brand.id)).scenes ?? []).find((s: any) => s.name === 'Gone Hall');
    expect(scene).toBeTruthy();
    expect((await page.request.delete(`/api/brands/${brand.id}/scenes/${scene.id}`)).ok()).toBe(true);
    // back to the conversation the way Activity leads there
    await page.goto(at);
    await arrived(page, '.sc-pstudio[data-kind="scene"]');
    await page.waitForTimeout(3000);
    await studio(page).getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForTimeout(1500);
    // the scene is gone: nothing may say it was saved, and nothing may lead to its page
    expect((await page.locator('.sc-toasts').allTextContents()).join(' | ')).not.toContain('saved');
    expect(new URL(page.url()).pathname).not.toContain(scene.id);
    expect(new URL(page.url()).pathname.startsWith(`/${slug}`)).toBe(true);
  });

  test('a scene used while its picture draws is announced once, and the bell leads to the scene (OP-H6)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const slug = await start(page);
    await place(page, 'A raw concrete hall with a low plinth under a skylight');
    await draw(page);
    await named(page, 'Six Hall');
    await recordToasts(page);
    // Try again, and Use while the new picture is drawing
    const startedAgain = page.waitForResponse(
      (r) => r.request().method() === 'POST' && START.test(r.url()) && r.request().postDataJSON()?.kind === 'again',
    );
    await tap(openQ(page), 'Try again');
    const jobId = `scene:${(await (await startedAgain).json()).jobId}`;
    const use = studio(page).getByRole('button', { name: 'Use this scene', exact: true });
    await expect(use).toBeVisible({ timeout: 10_000 });
    await use.click();
    // saved at once; the person leaves while the new picture is still drawing
    await expect(turn(page, 'you:use')).toBeVisible({ timeout: 10_000 });
    await studio(page).getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForURL((u) => !u.pathname.includes('/scenes/new/'));
    const { brandId, sceneId } = await sceneRef(page, 'Six Hall');
    const row = async () =>
      ((await (await page.request.get(`/api/brands/${brandId}/activity`)).json()).studio as any[]).find(
        (r) => r.id === jobId,
      );
    await expect.poll(async () => (await row())?.status, { timeout: 30_000 }).toBe('done');
    await page.waitForTimeout(3500);
    expect((await toastsSeen(page)).filter((t) => t.includes('Six Hall is drawn'))).toEqual([]);
    // the bell row for the used conversation opens the scene, not a studio
    await page.locator('.sc-topbar .sc-notif-btn').click();
    const bellRow = page.locator('.sc-notif-scroll a.sc-notif-row', { hasText: 'Six Hall' }).first();
    await expect(bellRow).toBeVisible();
    await bellRow.click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/scenes/${sceneId}$`));
    await expect(studio(page)).toHaveCount(0);
  });
});

test.describe('a read that fails once', () => {
  test('one failed examples read does not leave the set drawing forever (SC-H1)', async ({ page }) => {
    test.setTimeout(150_000);
    const ref = await toSetStart(page, 'A pale oak bench under a skylight', 'Oak Bench H1');
    // the first read after the press is delivered; the next one fails once
    let gets = 0;
    let dropped = false;
    await page.route(EXAMPLES, async (route) => {
      if (route.request().method() !== 'GET' || dropped) return route.fallback();
      gets++;
      if (gets === 2) {
        dropped = true;
        return route.abort('failed');
      }
      return route.fallback();
    });
    await tap(openQ(page), 'Draw it');
    await expect.poll(() => dropped, { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await exJob(page, ref))?.status, { timeout: 60_000 }).toBe('done');
    // the conversation hears it and goes on: the close-up is said and three more are offered
    await expect(studio(page).locator('[data-turn^="scenri:ex-close-"]')).toContainText('Here is a close-up.', {
      timeout: 15_000,
    });
    await expect(openQ(page)).toHaveAttribute('data-turn', 'q:set-more');
  });

  test('a scene page whose examples poll fails once still sees the run finish (OP-H10)', async ({ page }) => {
    test.setTimeout(120_000);
    const slug = await start(page);
    await place(page, 'A marble bath ledge with a brass tap by a steamy window');
    await draw(page);
    await named(page, 'Ten Bath');
    await tap(openQ(page), 'Use this scene');
    const offerSet = studio(page).locator('[data-turn="q:set-start"]:not([data-picked])');
    const done = studio(page).locator('[data-turn="q:set-done"]:not([data-picked])');
    await expect(offerSet.or(done)).toBeVisible({ timeout: 30_000 });
    if (await offerSet.isVisible()) await offerSet.getByRole('button', { name: 'Not now', exact: true }).click();
    await done.getByRole('button', { name: 'Open scene', exact: true }).click({ timeout: 30_000 });
    await page.waitForURL(new RegExp(`/${slug}/scenes/us-`));
    const offer = page.getByRole('button', { name: /^Draw it in use|^Draw them again/ });
    await expect(offer).toBeVisible({ timeout: 15_000 });

    // the page's second read of the running set fails once, as a dropped request does
    let reads = 0;
    await page.route(EXAMPLES, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      reads += 1;
      if (reads === 2) return route.abort('failed');
      return route.fallback();
    });
    await offer.click();
    const drawing = page.locator('.sc-scenepage-examples-state', { hasText: 'Drawing' });
    await expect(drawing).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => reads, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    // the run ends on the server; the page stops saying it draws
    await expect(drawing).toHaveCount(0, { timeout: 25_000 });
  });

  test('a scene page reads the whole brand list at most once per example that lands (OP-H11)', async ({ page }) => {
    test.setTimeout(90_000);
    const brand = await currentBrand(page);
    const placeHash = await uploadPng(page.request, 5);
    const made = await (
      await page.request.post(`/api/brands/${brand.id}/scenes`, {
        data: {
          name: 'Count Hall',
          prompt: 'A raw concrete hall with a low plinth under a skylight',
          lighting: 'One hard raking side light',
          previewHash: placeHash,
        },
      })
    ).json();
    const sceneId = made.scene.id as string;
    let brandReads = 0;
    page.on('request', (r) => {
      if (r.method() === 'GET' && new URL(r.url()).pathname === '/api/brands') brandReads += 1;
    });
    const ask = await page.request.post(`/api/brands/${brand.id}/scenes/${sceneId}/examples`, {
      data: { roles: ['hero', 'close', 'hands'] },
    });
    expect(ask.ok(), await ask.text()).toBe(true);
    // the page opened on a run already under way
    await page.goto(`/${brand.slug}/scenes/${sceneId}`);
    await expect(page.locator('.sc-scenepage, main').first()).toBeVisible();
    const atLoad = brandReads;
    let job: any;
    await expect
      .poll(
        async () => {
          job = (await (await page.request.get(`/api/brands/${brand.id}/scenes/${sceneId}/examples`)).json()).job;
          return job?.status;
        },
        { timeout: 60_000 },
      )
      .toBe('done');
    await page.waitForTimeout(4000);
    expect(brandReads - atLoad).toBeLessThanOrEqual(job.done.length + 1);
  });
});

// A press whose request failed at once used to leave its question latched: the
// button lit, nothing pressable, and a reload the only way on. The question is
// handed back, so Draw the scene can be pressed again and works.
test('a draw that fails to start hands the question back', async ({ page }) => {
  test.setTimeout(90_000);
  await start(page);
  await place(page, 'A narrow brick alley at dusk, wet cobbles and one lamp over a green door');
  let failed = 0;
  await page.route(START, async (route) => {
    if (route.request().method() === 'POST' && failed === 0) {
      failed += 1;
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"the engine fell over"}' });
    }
    return route.fallback();
  });
  await tap(openQ(page), 'Draw the scene');
  await expect.poll(() => failed).toBe(1);
  const again = floorQ(page).getByRole('button', { name: 'Draw the scene', exact: true });
  await expect(again).toBeEnabled({ timeout: 10_000 });
  await expect(floorQ(page)).not.toHaveAttribute('data-picked');
  await again.click();
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:(decide-|name)/, { timeout: 30_000 });
});
