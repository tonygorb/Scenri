import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { arrived, isolate } from './harness.js';
import { holdNext, switchBrand, uploadPng } from './realtime.js';

/**
 * Background work as the page hears of it: the bell across a brand switch, two
 * tabs on one library, a connection that drops or a Stop that never arrives,
 * and a server that restarts under running work. Draws are slow here, so work
 * is still running while the person moves. Every test finds its brands by name
 * and makes what it needs.
 */
isolate({
  env: {
    SCENRI_DEMO_BUILDS: '1',
    SCENRI_DEMO_REFS: '5',
    SCENRI_DEMO_ANALYSIS: 'usable',
    SCENRI_DEMO_READ_MS: '300',
    SCENRI_DEMO_DELAY_MS: '8000',
  },
});

const FIXTURE = 'E2E Fixture';
const OTHER = 'Other House';

type BrandRef = { id: string; slug: string };

/** A brand by its name, made when it is not there yet. */
async function brandNamed(req: APIRequestContext, name: string): Promise<BrandRef> {
  const find = async () =>
    ((await (await req.get('/api/brands')).json()) as { id: string; slug: string; json?: any }[]).find(
      (b) => b.json?.meta?.name === name,
    );
  let b = await find();
  if (!b) {
    await req.post('/api/brands', { data: { brand: { specVersion: '0.1', meta: { name } } } });
    b = await find();
  }
  return { id: b!.id, slug: b!.slug };
}

/** A saved presenter, written the way an import writes one: no draw to wait on. */
async function savedPresenter(req: APIRequestContext, brandId: string, name: string): Promise<string> {
  const hash = await uploadPng(req, 1);
  const res = await req.post(`/api/brands/${brandId}/presenters`, { data: { name, shotHashes: [hash] } });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { presenter: { id: string } }).presenter.id;
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

/** What the bell has filed for a brand in this browser. */
const feedIds = (page: Page, brandId: string) =>
  page.evaluate(
    (id) =>
      (JSON.parse(localStorage.getItem(`scenri:notifications-${id}`) ?? '[]') as { id: string }[]).map((n) => n.id),
    brandId,
  );
const activityOf = (brandId: string) => (r: { url(): string }) => r.url().includes(`/api/brands/${brandId}/activity`);

const wallCard = (p: Page, name: string) =>
  p.locator('.sc-owned .sc-lookcard', { has: p.locator('b', { hasText: new RegExp(`^${name}$`) }) });

async function deletePresenterFromWall(p: Page, name: string) {
  await wallCard(p, name).click({ button: 'right' });
  await p.getByRole('menuitem', { name: 'Delete presenter' }).click();
  await p
    .getByRole('alertdialog')
    .getByRole('button', { name: /Delete/ })
    .click();
  await expect(wallCard(p, name)).toHaveCount(0);
}

test.describe('the bell across a brand switch', () => {
  test('an answer for the brand just left says nothing in the brand switched to (OP-H1)', async ({ page }) => {
    test.setTimeout(90_000);
    const A = await brandNamed(page.request, FIXTURE);
    const B = await brandNamed(page.request, OTHER);
    // one finished shot in B, so B has something of its own to announce
    const ws = await (await page.request.get(`/api/brands/${B.id}/workspace`)).json();
    const made = await (
      await page.request.post('/api/nodes', {
        data: {
          projectId: ws.project.id,
          kind: 'generation',
          engineId: 'demo',
          count: 1,
          prompt: 'other house shot',
          width: 512,
          height: 512,
        },
      })
    ).json();
    await expect
      .poll(async () => (await (await page.request.get(`/api/nodes/${made.id}`)).json()).status, { timeout: 30_000 })
      .toBe('done');
    const aShot = ((await (await page.request.get(`/api/brands/${A.id}/activity`)).json()).nodes[0] as { id: string })
      .id;

    // Home, where a finished shot is announced; the first answer is the baseline
    const baseline = page.waitForResponse(activityOf(A.id));
    await page.goto(`/${A.slug}`);
    await baseline;
    await recordToasts(page);

    // A's next idle tick is in flight and slow when the brand changes
    const held = await holdNext(page, new RegExp(`/api/brands/${A.id}/activity`));
    await held.caught;
    const bFirst = page.waitForResponse(activityOf(B.id));
    await switchBrand(page, OTHER);
    await expect(page).toHaveURL(new RegExp(`/${B.slug}$`));
    await bFirst;
    await page.waitForTimeout(500);
    held.release();

    // one more idle tick of B after the late answer
    await page.waitForResponse(activityOf(B.id), { timeout: 10_000 });
    await page.waitForTimeout(800);
    expect(await toastsSeen(page)).toEqual([]);
    expect(await feedIds(page, B.id)).not.toContain(`node:${aShot}`);
    expect(await feedIds(page, A.id)).not.toContain(`node:${made.id}`);
  });

  test('"Use in a shot" on a scene-ready toast opens the brand the scene was made in (OP-H2)', async ({ page }) => {
    test.setTimeout(60_000);
    const A = await brandNamed(page.request, FIXTURE);
    const B = await brandNamed(page.request, OTHER);
    const baseline = page.waitForResponse(activityOf(A.id));
    await page.goto(`/${A.slug}`);
    await baseline;
    const hash = await uploadPng(page.request, 3);
    const res = await page.request.post(`/api/brands/${A.id}/asset-builds`, {
      data: {
        kind: 'scene',
        name: 'Toast Hall',
        instruction: 'a raw concrete hall with a low plinth',
        imageHashes: [hash],
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
    const card = page.locator('.sc-toast', { hasText: 'Toast Hall is ready' });
    await expect(card).toBeVisible({ timeout: 30_000 });

    // a success with actions stays up long enough to change brand under it
    await switchBrand(page, OTHER);
    await expect(page).toHaveURL(new RegExp(`/${B.slug}$`));
    const went: string[] = [];
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) went.push(f.url());
    });
    await card.getByRole('button', { name: 'Use in a shot' }).click();
    await expect.poll(() => went.find((u) => u.includes('scene='))).toBeTruthy();
    const at = new URL(went.find((u) => u.includes('scene='))!);
    expect(at.pathname.startsWith(`/${A.slug}/`)).toBe(true);
  });

  test('a draw that finished while the person was in another brand is filed in its own brand (OP-X7)', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const A = await brandNamed(page.request, FIXTURE);
    await brandNamed(page.request, OTHER);
    const started = await (
      await page.request.post(`/api/brands/${A.id}/scene-studio/jobs`, {
        data: {
          kind: 'again',
          reading: {
            name: 'Away Draw',
            prompt: 'A raw concrete hall with a low plinth, soft window light from the left.',
            lighting: 'Soft window light',
            subject: 'product',
            description: 'A raw concrete hall.',
          },
          conversation: 'c0ffee07',
          label: 'Away Draw',
        },
      })
    ).json();
    // a fresh load reads the work at once rather than on the next idle tick
    const baseline = page.waitForResponse(activityOf(A.id));
    await page.goto(`/${A.slug}/scenes`);
    await baseline;
    await expect(page.locator('.sc-lookcard[data-build]', { hasText: 'Away Draw' })).toContainText('Drawing', {
      timeout: 10_000,
    });

    // away in the other brand while it finishes
    await switchBrand(page, OTHER);
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/brands/${A.id}/scene-studio/jobs/${started.jobId}`)).json()).status,
        { timeout: 30_000 },
      )
      .toBe('done');
    await page.waitForTimeout(1500);

    // back in its own brand, the finish is in its record
    await switchBrand(page, FIXTURE);
    await expect(page).toHaveURL(new RegExp(`/${A.slug}(/|$)`));
    await page.waitForResponse(activityOf(A.id));
    await page.waitForTimeout(800);
    expect(await feedIds(page, A.id)).toContain(`scene:${started.jobId}`);
  });
});

test.describe('two tabs on one library', () => {
  test('a presenter deleted in another tab leaves this tab when the person comes back to it (OP-H13)', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const brand = await brandNamed(page.request, FIXTURE);
    await savedPresenter(page.request, brand.id, 'Tabbed');
    await page.goto(`/${brand.slug}/presenters`);
    await expect(wallCard(page, 'Tabbed')).toBeVisible();

    const other = await context.newPage();
    await other.goto(`/${brand.slug}/presenters`);
    await deletePresenterFromWall(other, 'Tabbed');

    // back to the first tab, the way a person comes back to one
    await page.bringToFront();
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await expect(wallCard(page, 'Tabbed')).toHaveCount(0, { timeout: 12_000 });
  });

  test('two tabs on one scene conversation draw once, and a conversation used in one stays used (OP-X3)', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const brand = await brandNamed(page.request, FIXTURE);
    const starts: string[] = [];
    const count = (p: Page, tab: string) =>
      p.on('request', (r) => {
        if (r.method() === 'POST' && /\/scene-studio\/jobs$/.test(r.url()))
          starts.push(`${tab}:${JSON.parse(r.postData() ?? '{}').kind}`);
      });
    count(page, 'A');
    const studio = (p: Page) => p.locator('.sc-pstudio[data-kind="scene"]');
    const openQ = (p: Page) => studio(p).locator('[data-turn^="q:"]:not([data-picked])').last();
    const line = (p: Page) => studio(p).locator('.sc-pstudio-foot textarea');

    await page.goto(`/${brand.slug}/scenes/new`);
    await arrived(page, '.sc-pstudio[data-kind="scene"]');
    await page.waitForURL(new RegExp(`/${brand.slug}/scenes/new/[a-f0-9]+$`));
    const at = new URL(page.url()).pathname;
    await line(page).fill('A white cyclorama under hard flash, seen straight on, on a low plinth, mist lying low');
    await line(page).press('Enter');
    await expect(openQ(page)).toHaveAttribute('data-turn', /^q:agree-/, { timeout: 15_000 });
    await openQ(page).getByRole('button', { name: 'Draw the scene', exact: true }).click();
    await line(page).fill('Twin Cyc');
    await line(page).press('Enter');

    // the same conversation in a second tab, while it draws
    const other = await context.newPage();
    count(other, 'B');
    await other.goto(at);
    await arrived(other, '.sc-pstudio[data-kind="scene"]');
    await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/, { timeout: 30_000 });
    await expect(openQ(other)).toHaveAttribute('data-turn', /^q:decide-/, { timeout: 30_000 });
    const jobs = ((await (await page.request.get(`/api/brands/${brand.id}/activity`)).json()).studio as any[]).filter(
      (r) => r.conversation === at.split('/').pop(),
    );
    expect(starts.filter((s) => s.startsWith('B:'))).toEqual([]);
    expect(jobs.filter((j) => j.job === 'again')).toHaveLength(1);

    // used and finished in the first tab
    await openQ(page).getByRole('button', { name: 'Use this scene', exact: true }).click();
    const offer = studio(page).locator('[data-turn="q:set-start"]:not([data-picked])');
    const done = studio(page).locator('[data-turn="q:set-done"]:not([data-picked])');
    await expect(offer.or(done)).toBeVisible({ timeout: 30_000 });
    if (await offer.isVisible()) await offer.getByRole('button', { name: 'Not now', exact: true }).click();
    await done.getByRole('button', { name: 'Open scene', exact: true }).click();
    await page.waitForURL(/\/scenes\/us-/);

    // the second tab is still open on it, and a person types a change there
    await other.bringToFront();
    await line(other).fill('make the plinth a little lower');
    await line(other).press('Enter');
    await other.waitForTimeout(2000);

    // the wall in the first tab: the conversation was used, so it is no draft
    await page.bringToFront();
    await page.goto(`/${brand.slug}/scenes`);
    await page.waitForTimeout(1500);
    await expect(page.locator('.sc-lookcard[data-build]', { hasText: 'Twin Cyc' })).toHaveCount(0);
    const saved = ((await (await page.request.get('/api/brands')).json()) as any[])
      .find((b) => b.id === brand.id)
      .json.scenes.filter((s: { name: string }) => s.name === 'Twin Cyc');
    expect(saved).toHaveLength(1);
  });

  test('a presenter deleted while their chip waits in the brief cannot be sent without them (OP-X6)', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const brand = await brandNamed(page.request, FIXTURE);
    const id = await savedPresenter(page.request, brand.id, 'Chipped');
    // "Use in a shot": the brief opens with the person in it, and words are added
    await page.goto(`/${brand.slug}/create?presenter=${id}&compose=1`);
    await expect(page.locator('.sc-brief .sc-token', { hasText: 'Chipped' })).toBeVisible({ timeout: 15_000 });
    await page.locator('.sc-brief-line').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' on a quiet beach at dawn');

    // same session: to the wall through the app's own nav, delete them, and back
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Presenters' }).click();
    await expect(wallCard(page, 'Chipped')).toBeVisible();
    await deletePresenterFromWall(page, 'Chipped');
    await page.getByRole('link', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\/create/);
    await expect(page.locator('.sc-brief')).toContainText('quiet beach', { timeout: 10_000 });
    await page.waitForTimeout(1500);

    const sent: unknown[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/api\/nodes$/.test(r.url())) sent.push(r.postDataJSON());
    });
    const send = page.locator('.sc-send').first();
    if ((await send.getAttribute('aria-disabled')) !== 'true') await send.click();
    await page.waitForTimeout(1500);
    // either the chip is taken out and it says so, or the brief cannot go while it names somebody who is gone
    expect(sent, 'a shot was sent that silently leaves the deleted presenter out').toEqual([]);
  });
});

test.describe('a connection that drops', () => {
  const studio = (p: Page) => p.locator('.sc-pstudio');
  const line = (p: Page) => p.locator('.sc-convo-card textarea');
  const pill = (p: Page) => p.locator('.sc-convo-send');
  const openQ = (p: Page) => studio(p).locator('[data-turn^="q:"]:not([data-picked])').last();
  const tap = (q: Locator, name: string) => q.getByRole('button', { name, exact: true }).click();
  const say = async (p: Page, text: string) => {
    await line(p).fill(text);
    await line(p).press('Enter');
  };

  /** A scene studio with a place said in full, read back and ready to draw. */
  async function readyToDraw(p: Page) {
    const { slug } = await brandNamed(p.request, FIXTURE);
    await p.goto(`/${slug}/scenes/new`);
    await arrived(p, '.sc-pstudio[data-kind="scene"]');
    await p.waitForURL(new RegExp(`/${slug}/scenes/new/[a-f0-9]+$`));
    await say(p, 'A white cyclorama under hard flash, seen straight on, on a low plinth, mist lying low');
    await expect(openQ(p)).toHaveAttribute('data-turn', /^q:agree-/, { timeout: 15_000 });
  }

  test('a Stop whose request is lost on the way still stops the draw (FAIL-X9)', async ({ page }) => {
    test.setTimeout(90_000);
    await readyToDraw(page);
    // the first Stop to leave the page is lost on the way; a second would arrive
    let cancels = 0;
    await page.route(/\/scene-studio\/jobs\/[^/]+\/cancel$/, (route) => {
      cancels += 1;
      return cancels === 1 ? route.abort('internetdisconnected') : route.fallback();
    });
    await tap(openQ(page), 'Draw the scene');
    await expect(openQ(page)).toHaveAttribute('data-turn', 'q:name');
    await expect(pill(page)).toHaveText('Stop');
    await pill(page).click();
    await expect.poll(() => cancels, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
    await expect(studio(page)).toContainText('Stopped. Nothing was drawn.', { timeout: 15_000 });
    await expect(studio(page).locator('.sc-pstudio-well img')).toHaveCount(0);
  });

  test('a scene draw that loses the server says so, and lands once the server is back (FAIL-X10)', async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await readyToDraw(page);
    await tap(openQ(page), 'Draw the scene');
    await expect(openQ(page)).toHaveAttribute('data-turn', 'q:name');
    await context.setOffline(true);
    await expect(studio(page)).toContainText('Lost touch with Scenri. Still trying.', { timeout: 20_000 });
    await context.setOffline(false);
    await say(page, 'Back Online');
    await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/, { timeout: 30_000 });
    await expect(studio(page).locator('.sc-pstudio-well img')).toHaveCount(1);
    await expect(studio(page)).not.toContainText('Lost touch with Scenri');
  });

  test('once lost work is declared lost, the studio no longer says it has lost touch (INF-H5)', async ({ page }) => {
    test.setTimeout(90_000);
    await readyToDraw(page);
    // three asks about the draw fail as a dead server's do, then the server answers it never heard of it
    let asks = 0;
    await page.route(/\/api\/brands\/[^/]+\/scene-studio\/jobs\/[^/]+$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      asks++;
      if (asks <= 3) return route.abort('connectionrefused');
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"job not found"}' });
    });
    await tap(openQ(page), 'Draw the scene');
    await expect(studio(page)).toContainText('Lost touch with Scenri. Still trying.', { timeout: 20_000 });
    await expect(studio(page)).toContainText('That work is gone: the server restarted while it ran.', {
      timeout: 20_000,
    });
    await expect(studio(page)).not.toContainText('Lost touch with Scenri');
  });
});

/**
 * A server of this test's own, killed under running work and started again on
 * the same library. The harness server has no restart, so this one runs on a
 * port inside this lane's e2e band that no worker takes: the workers sit at +0
 * to +3 and updates.spec's fixtures at +10 to +86.
 */
test.describe('a restart under running work', () => {
  const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
  const PORT = Number(process.env.SCENRI_E2E_PORT ?? 4757) + 90;
  const BASE = `http://127.0.0.1:${PORT}`;
  let home = '';
  let child: ChildProcess | null = null;

  const version = async (): Promise<{ home?: string } | null> => {
    try {
      const res = await fetch(`${BASE}/api/version`);
      return res.ok ? ((await res.json()) as { home?: string }) : null;
    } catch {
      return null;
    }
  };

  async function boot(extra: Record<string, string>): Promise<void> {
    child = spawn(process.execPath, ['--import', 'tsx', 'packages/cli/src/index.ts', 'serve'], {
      cwd: ROOT,
      stdio: 'ignore',
      env: {
        ...process.env,
        SCENRI_NO_OPEN: '1',
        SCENRI_HOST: '127.0.0.1',
        SCENRI_PORT: String(PORT),
        SCENRI_HOME: home,
        SCENRI_DEMO_ENGINE: '1',
        SCENRI_NO_UPDATE_CHECK: '1',
        SCENRI_NO_GUIDE: '1',
        SCENRI_NO_CONTENT_FETCH: '1',
        SCENRI_NO_CODEX: '1',
        SCENRI_NO_DESKTOP: '1',
        OPENROUTER_API_KEY: '',
        REPLICATE_API_TOKEN: '',
        FAL_KEY: '',
        SCENRI_DEMO_BUILDS: '1',
        SCENRI_DEMO_REFS: '5',
        SCENRI_DEMO_ANALYSIS: 'usable',
        ...extra,
      },
    });
    for (let i = 0; i < 150; i++) {
      if ((await version())?.home === home) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Scenri never answered on ${BASE} for ${home}`);
  }

  async function kill(): Promise<void> {
    const c = child;
    child = null;
    if (!c || c.exitCode !== null) return;
    const gone = new Promise<void>((r) => c.once('exit', () => r()));
    c.kill('SIGKILL');
    await gone;
    for (let i = 0; i < 50 && (await version()) !== null; i++) await new Promise((r) => setTimeout(r, 100));
  }

  test.beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'sc-e2e-restart-'));
  });
  test.afterAll(async () => {
    await kill();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  test('work the server lost is said to have not finished, not dropped in silence (OP-H8)', async ({ page }) => {
    test.setTimeout(120_000);
    // slow enough that everything is still running when the server dies
    await boot({ SCENRI_DEMO_DELAY_MS: '60000' });
    const post = async (path: string, body: unknown) =>
      (
        await fetch(`${BASE}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).json() as Promise<any>;
    const brand = await post('/api/brands', { brand: { specVersion: '0.1', meta: { name: 'Restart House' } } });
    const slug = ((await (await fetch(`${BASE}/api/brands`)).json()) as any[]).find((b) => b.id === brand.id).slug;

    const firstRead = page.waitForResponse((r) => r.url().includes(`/api/brands/${brand.id}/activity`));
    await page.goto(`${BASE}/${slug}`);
    await firstRead;
    await recordToasts(page);

    // a scene draw and a presenter view, both running
    await post(`/api/brands/${brand.id}/scene-studio/jobs`, {
      kind: 'again',
      reading: {
        name: 'Restart Hall',
        prompt: 'A raw concrete hall with a low plinth, soft window light from the left.',
        lighting: 'Soft window light',
        subject: 'product',
        description: 'A raw concrete hall.',
      },
      conversation: 'c0ffee02',
      label: 'Restart Hall',
    });
    const draft = await post(`/api/brands/${brand.id}/presenter-drafts`, {
      source: 'synthetic',
      direction: 'Rhea, a woman in her 30s',
      name: 'Rhea',
    });
    await post(`/api/brands/${brand.id}/presenter-drafts/${draft.id}/views/portrait/generate`, {});

    // the bell sees both running
    await page.locator('.sc-topbar .sc-notif-btn').click();
    // In progress sits above the finished list, outside its scroller (v0.18.0)
    const rows = page.locator('.sc-notif-pop .sc-notif-row');
    await expect(rows.filter({ hasText: 'Restart Hall' })).toBeVisible({ timeout: 15_000 });
    await expect(rows.filter({ hasText: 'Rhea' })).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');

    // the server dies under them and comes back on the same library
    await kill();
    await boot({});
    const said = async (name: string) => {
      const seen = await toastsSeen(page);
      const feed = await page.evaluate(
        (id) => JSON.parse(localStorage.getItem(`scenri:notifications-${id}`) ?? '[]') as { title: string }[],
        brand.id,
      );
      return seen.some((t) => t.includes(name)) || feed.some((n) => n.title === name);
    };
    await expect.poll(() => said('Restart Hall'), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => said('Rhea'), { timeout: 20_000 }).toBe(true);
  });
});
