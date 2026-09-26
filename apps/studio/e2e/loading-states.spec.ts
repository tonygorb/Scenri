import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * Waiting, in one language (DESIGN.md, Waiting): a picture being made carries
 * the moving band inside its own box and nowhere else; a picture or a page
 * that exists and has not painted holds its place still; nothing that was on
 * screen blanks or moves while something newer arrives.
 *
 * The demo engine takes long enough here for every pending state to be seen.
 */
isolate({ env: { SCENRI_DEMO_DELAY_MS: '5000', SCENRI_DEMO_STAGGER_MS: '1200' } });

test.beforeEach(async ({ page }, testInfo) => {
  await page.bringToFront();
  testInfo.setTimeout(90_000);
});

const line = (p: Page) => p.locator('.sc-brief-line').first();
const dock = (p: Page) => p.locator('.sc-canvas-dock').first();
const tile = (p: Page, id: string) => p.locator(`.sc-cell[data-fb-node="${id}"]`);

async function brandSlug(p: Page): Promise<string> {
  const brands = await (await p.request.get('/api/brands')).json();
  return brands[0].slug as string;
}

async function openFeed(p: Page, slug: string, count: number, format: string) {
  await p.goto(`/${slug}/create`);
  await p.evaluate(
    ({ c, f }) => {
      localStorage.setItem('scenri:count', String(c));
      localStorage.setItem('scenri:format', JSON.stringify(f));
    },
    { c: count, f: format },
  );
  await p.goto(`/${slug}/create`);
  await expect(line(p)).toBeVisible();
}

async function send(p: Page, said: string): Promise<string[]> {
  const answered = p.waitForResponse((r) => r.url().endsWith('/api/nodes') && r.request().method() === 'POST');
  await line(p).click();
  await p.keyboard.type(said);
  await dock(p).locator('.sc-send').click();
  const body = await (await answered).json();
  return (body.siblings as { id: string }[]).map((s) => s.id);
}

const box = (p: Page, selector: string) =>
  p.evaluate((sel) => {
    const b = document.querySelector(sel)?.getBoundingClientRect();
    return b ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] : null;
  }, selector);

async function doneShot(p: Page): Promise<{ id: string; image: string }> {
  const brand = (await (await p.request.get('/api/brands')).json())[0];
  const page = await (await p.request.get(`/api/brands/${brand.id}/feed?limit=60`)).json();
  const n = (page.items as { id: string; status: string; images: string[] }[]).find(
    (x) => x.status === 'done' && x.images.length,
  );
  if (!n) throw new Error('no finished shot to refine');
  return { id: n.id, image: n.images[0] };
}

async function refineFromOverlay(p: Page, said: string): Promise<string> {
  const answered = p.waitForResponse((r) => r.url().endsWith('/api/nodes') && r.request().method() === 'POST');
  await p.locator('.sc-ovl-edit .sc-brief-line').click();
  await p.keyboard.type(said);
  await p.locator('.sc-ovl-edit .sc-send').click();
  return (await (await answered).json()).id as string;
}

test('each of four outputs holds its own shape and carries its own band, from the first frame', async ({ page }) => {
  const slug = await brandSlug(page);
  await openFeed(page, slug, 4, 'landscape');
  // The stand-ins and then the running tiles, sampled from the moment Generate
  // is pressed: every one 16:9, never square, never the 4:5 fallback.
  const sampling = page.evaluate(async () => {
    const seen: string[] = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      for (const c of document.querySelectorAll('.sc-cell[data-running]')) {
        const r = c.getBoundingClientRect();
        seen.push((r.width / r.height).toFixed(2));
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    return [...new Set(seen)];
  });
  const ids = await send(page, 'four landscape shots');
  expect(ids).toHaveLength(4);
  const ratios = await sampling;
  // 16:9 inside a 1px border rounds to 1.77 or 1.78; square would be 1.00
  for (const r of ratios) expect(Number(r)).toBeGreaterThan(1.7);

  for (const id of ids) {
    await expect(tile(page, id)).toHaveAttribute('data-running', 'true');
    // the band is this tile's, inside this tile, and nowhere wider
    const [t, b] = await Promise.all([
      box(page, `.sc-cell[data-fb-node="${id}"]`),
      box(page, `.sc-cell[data-fb-node="${id}"] .sc-rendering`),
    ]);
    expect(b).not.toBeNull();
    expect(b?.[2]).toBeLessThanOrEqual((t?.[2] ?? 0) + 1);
    expect(b?.[3]).toBeLessThanOrEqual((t?.[3] ?? 0) + 1);
  }
  // no gold anywhere on a running tile
  const gold = await page.evaluate(
    () =>
      [...document.querySelectorAll('.sc-cell[data-running], .sc-cell[data-running] *')].filter((e) =>
        /201, 165, 46/.test(getComputedStyle(e).backgroundImage + getComputedStyle(e).backgroundColor),
      ).length,
  );
  expect(gold).toBe(0);
  // siblings land on their own: the first to finish is a picture while others still render
  await expect(tile(page, ids[0]).locator('.sc-cellimg')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('.sc-cell[data-running]').count()).toBeGreaterThanOrEqual(1);
  for (const id of ids) await expect(tile(page, id).locator('.sc-cellimg')).toBeVisible({ timeout: 30_000 });
});

test('refining keeps the shot on the stage, and only the new step carries the band', async ({ page }) => {
  const slug = await brandSlug(page);
  const parent = await doneShot(page);
  await page.goto(`/${slug}/create/shots/${parent.id}`);
  await expect(page.locator('.sc-ovl-stage .sc-stage-img')).toBeVisible();
  const child = await refineFromOverlay(page, 'warmer light');

  // the stage still shows the shot being refined, whole
  await expect(page).toHaveURL(new RegExp(`/shots/${parent.id}`));
  await expect(page.locator('.sc-ovl-stage .sc-stage-img')).toHaveAttribute('src', new RegExp(parent.image));
  await expect(page.locator('.sc-ovl-stage .sc-stage-wait')).toHaveCount(0);
  // the band is the new step's, in the strip, and not on the stage
  const bands = page.locator('.sc-ovl-stage .sc-rendering');
  await expect(page.locator('.sc-trail .sc-thumb-wait .sc-rendering')).toHaveCount(1);
  expect(await bands.count()).toBe(await page.locator('.sc-trail .sc-rendering').count());
  const [stage, band] = await Promise.all([
    box(page, '.sc-ovl-stage'),
    box(page, '.sc-trail .sc-thumb-wait .sc-rendering'),
  ]);
  expect(band?.[2]).toBeLessThan((stage?.[2] ?? 0) / 4);
  // one refinement at a time from here: the field waits for this one
  await expect(page.locator('.sc-ovl-edit .sc-send')).toHaveAttribute('title', /Wait for this refinement to finish/);

  // when it lands, the stage moves onto it
  await expect(page).toHaveURL(new RegExp(`/shots/${child}`), { timeout: 30_000 });
  await expect(page.locator('.sc-ovl-stage .sc-stage-img')).not.toHaveAttribute('src', new RegExp(parent.image));
  await expect(page.locator('.sc-trail .sc-rendering')).toHaveCount(0);
});

test('refining a keeper from the Keepers lens never drops the open shot for a spinner', async ({ page }) => {
  const slug = await brandSlug(page);
  const parent = await doneShot(page);
  await page.request.post(`/api/nodes/${parent.id}/keep`, { data: { kept: true } });
  await page.goto(`/${slug}/create?tab=keepers`);
  await page.goto(`/${slug}/create/shots/${parent.id}?tab=keepers`);
  await expect(page.locator('.sc-ovl-stage .sc-stage-img')).toBeVisible();
  await page.evaluate(() => {
    (window as { __spun?: boolean }).__spun = false;
    new MutationObserver(() => {
      if (document.querySelector('.sc-ovl-wait')) (window as { __spun?: boolean }).__spun = true;
    }).observe(document.body, { subtree: true, childList: true });
  });
  const child = await refineFromOverlay(page, 'cooler light');
  await expect(page).toHaveURL(new RegExp(`/shots/${child}`), { timeout: 30_000 });
  await expect(page.locator('.sc-ovl-stage .sc-stage-img')).toBeVisible();
  expect(await page.evaluate(() => (window as { __spun?: boolean }).__spun)).toBe(false);
});

test('a revisited Create paints its shots at once, with no stand-ins', async ({ page }) => {
  const slug = await brandSlug(page);
  await page.goto(`/${slug}/create`);
  await expect(page.locator('.sc-cell .sc-cellimg').first()).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}$`));
  await page.evaluate(() => {
    (window as { __stood?: boolean }).__stood = false;
    new MutationObserver(() => {
      if (document.querySelector('.sc-cell[data-placeholder]')) (window as { __stood?: boolean }).__stood = true;
    }).observe(document.body, { subtree: true, childList: true });
  });
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Create' }).click();
  await expect(page.locator('.sc-cell .sc-cellimg').first()).toBeVisible();
  expect(await page.evaluate(() => (window as { __stood?: boolean }).__stood)).toBe(false);
});

test('slow pictures hold their cards still, and loading never wears the generation band', async ({ page }) => {
  const slug = await brandSlug(page);
  let release: () => void = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route(
    (url) => /\/api\/(scene|presenter|showcase|demo-product)/.test(url.pathname) && /[?&]w=/.test(url.search),
    async (route) => {
      await held;
      await route.continue();
    },
  );
  // Products first: without the library download (as here) a demo product has
  // no picture at all, and its card is the blank box, never the band.
  await page.goto(`/${slug}/products`);
  await expect(page.locator('.sc-lookcard:not([data-variant="skeleton"])').first()).toBeVisible();
  expect(await page.locator('.sc-rendering').count()).toBe(0);
  for (const wall of ['presenters', 'scenes']) {
    await page.goto(`/${slug}/${wall}`);
    const card = page.locator('.sc-lookcard:not([data-variant="skeleton"])').first();
    await expect(card).toBeVisible();
    const before = await card.boundingBox();
    // a picture that exists is waiting still, not being made
    await expect(card.locator('img[data-reveal]:not([data-ready])')).toBeAttached();
    await expect(card.locator('.sc-placeholder')).toBeAttached();
    expect(await page.locator('.sc-rendering').count()).toBe(0);
    expect(before?.height ?? 0).toBeGreaterThan(40);
    if (wall === 'scenes') {
      release();
      await expect(card.locator('img[data-ready]')).toBeAttached({ timeout: 15_000 });
      await expect(card.locator('.sc-placeholder')).toHaveCount(0);
      const after = await card.boundingBox();
      expect(Math.round(after?.height ?? 0)).toBe(Math.round(before?.height ?? 0));
      expect(Math.round(after?.y ?? 0)).toBe(Math.round(before?.y ?? 0));
    }
  }
});

test('library pictures on their way hold their place, then appear without a reload', async ({ page }) => {
  const slug = await brandSlug(page);
  const state = { arriving: true, installs: 0 };
  let showcaseReads = 0;
  await page.route('**/api/brands/*/activity*', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, content: { ...state } } });
  });
  await page.route('**/api/showcase', async (route) => {
    showcaseReads += 1;
    const res = await route.fetch();
    const body = await res.json();
    // the first read is the one made before the download landed
    if (showcaseReads === 1) for (const e of body.showcase) e.previewUrl = null;
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(`/${slug}`);
  const tiles = page.locator('.sc-showcase-tile');
  await expect(tiles.first()).toBeVisible();
  // on its way: the held place, never the empty-picture glyph
  await expect(tiles.first().locator('.sc-lookcard-blank[data-waiting]')).toBeVisible({ timeout: 15_000 });
  expect(await tiles.locator('.sc-lookcard-blank:not([data-waiting])').count()).toBe(0);
  // one quiet row in the bell says what is happening
  await page.getByRole('button', { name: 'Activity' }).click();
  await expect(page.getByText('Downloading the Scenri library')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    (window as { __skeleton?: boolean }).__skeleton = false;
    new MutationObserver(() => {
      if (document.querySelector('.sc-showcase-tile ~ [data-variant="skeleton"], [data-variant="skeleton"]'))
        (window as { __skeleton?: boolean }).__skeleton = true;
    }).observe(document.body, { subtree: true, childList: true });
  });
  state.arriving = false;
  state.installs = 1;
  // the catalogs are read again, quietly: the same cards gain their pictures
  await expect(tiles.first().locator('img[data-reveal]')).toBeAttached({ timeout: 20_000 });
  expect(showcaseReads).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => (window as { __skeleton?: boolean }).__skeleton)).toBe(false);
});

test('under reduced motion the band rests and the placeholder is still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const slug = await brandSlug(page);
  await openFeed(page, slug, 1, 'square');
  const [id] = await send(page, 'one still shot');
  await expect(tile(page, id)).toHaveAttribute('data-running', 'true');
  const band = await tile(page, id)
    .locator('.sc-rendering')
    .evaluate((el) => {
      const s = getComputedStyle(el, '::after');
      return { name: s.animationName, transform: s.transform };
    });
  expect(band.name).toBe('none');
  expect(band.transform).toBe('none');
  // the clock still counts: proof of life that is not motion
  await expect(tile(page, id).locator('[role="timer"]')).toBeVisible();
  await expect(tile(page, id).locator('.sc-cellimg')).toBeVisible({ timeout: 30_000 });
});
