import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The brand menu with a real library behind it.
 *
 * At twenty-one brands the panel used to be as tall as the screen, a wall of
 * logos with Settings and the way out pushed to its bottom edge. Past six
 * brands it now leads with the ones you were just in and keeps every brand, A to
 * Z, in one scroller of a fixed height, so the claims worth pinning are about
 * order and about height: what comes first, what is all there, and that adding
 * brands never makes the panel taller.
 */

// A Scenri of this file's own, on an empty home, seeded from scratch.
isolate();

const NAMES = ['Vela', 'Castro', 'Aer', 'Olivar', 'Bucherer', 'Nocturne', 'Halde', 'Glenmoor'];

const api = async (p: Page, path: string, init?: RequestInit) =>
  p.evaluate(
    async ([u, i]) => {
      const r = await fetch(u as string, i as RequestInit);
      return r.json();
    },
    [path, init ?? undefined],
  );

async function home(p: Page): Promise<string> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  return decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
}

/** Brands made through the API, returned by display name so a test can visit one. */
async function addBrands(p: Page, names: string[]): Promise<Map<string, string>> {
  for (const name of names) {
    await api(p, '/api/brands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brand: { specVersion: '0.1', meta: { name } } }),
    });
  }
  const all = (await api(p, '/api/brands')) as { slug: string; json: { meta?: { name?: string } } }[];
  return new Map(all.map((b) => [b.json?.meta?.name ?? b.slug, b.slug]));
}

const panel = (p: Page) => p.locator('.sc-menu');
const scroller = (p: Page) => p.locator('.sc-menu-brands');
const namesIn = (p: Page) => scroller(p).locator('.sc-menu-brand-lb > span:first-child').allTextContents();

async function openMenu(p: Page) {
  await p.locator('.sc-org-btn').click();
  await expect(panel(p)).toBeVisible();
  // the panel arrives with a scale; measure it once it has landed
  await panel(p).evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
}

test('a long list leads with where you have been, keeps every brand, and stays one height', async ({ page }) => {
  const own = await home(page);
  const slugs = await addBrands(page, NAMES);

  // Where this browser has been: Vela, then Castro, then back home.
  for (const name of ['Vela', 'Castro']) {
    await page.goto(`/${slugs.get(name)}`);
    await expect(page.locator('.sc-org-btn')).toBeVisible();
  }
  await page.goto(`/${own}`);
  await openMenu(page);

  // One list, no labels: the brand you are in first and checked, the brands
  // you were just in under it, a hairline, then everything else A to Z.
  await expect(scroller(page).locator('.sc-menu-label')).toHaveCount(0);
  await expect(scroller(page).locator('> .sc-menu-rule')).toHaveCount(1);
  const names = await namesIn(page);
  expect(names[0]).toBe('E2E Fixture');
  await expect(scroller(page).locator('.sc-menu-item').first()).toHaveAttribute('data-current', 'true');
  expect(names.slice(1, 3)).toEqual(['Castro', 'Vela']);
  // every brand exactly once
  expect([...names].sort()).toEqual([...NAMES, 'E2E Fixture'].sort());
  const rest = names.slice(5);
  expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
  await expect(scroller(page).locator('.sc-menu-item[data-current] .sc-menu-check')).toHaveCount(1);

  // A compact list: rows you scan, not pictures you read.
  const rowH = await scroller(page)
    .locator('.sc-menu-item')
    .nth(1)
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(rowH).toBe(36);

  // The list scrolls inside itself; the panel does not, and the way out is on
  // screen without reaching for it.
  const fit = await scroller(page).evaluate((el) => ({ h: el.clientHeight, s: el.scrollHeight }));
  expect(fit.h).toBeLessThanOrEqual(36 * 8.5 + 13 + 1);
  expect(fit.s).toBeGreaterThan(fit.h);
  const tall = await panel(page).evaluate((el) => ({
    h: el.getBoundingClientRect().height,
    s: el.scrollHeight,
    c: el.clientHeight,
  }));
  expect(tall.s).toBeLessThanOrEqual(tall.c + 1);
  await expect(page.locator('.sc-menu-item[data-quit]')).toBeInViewport();
  await page.keyboard.press('Escape');

  // Eight more brands, and the panel is exactly as tall as it was.
  await addBrands(
    page,
    NAMES.map((n) => `${n} Studio`),
  );
  await page.reload();
  await openMenu(page);
  const again = await panel(page).evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.abs(again - tall.h)).toBeLessThan(1);
});

test('a query searches every brand, and Enter opens the first one you are not in', async ({ page }) => {
  const own = await home(page);
  const slugs = await addBrands(page, []);
  await page.goto(`/${own}`);
  await openMenu(page);

  const finder = page.getByRole('searchbox', { name: 'Find a brand' });
  await finder.fill('noc');
  // A query replaces both sections with its hits, A to Z, across the library.
  await expect(scroller(page).locator('> .sc-menu-label')).toHaveCount(0);
  expect(await namesIn(page)).toEqual(['Nocturne', 'Nocturne Studio']);

  await finder.fill('zzz');
  await expect(page.locator('.sc-menu-none')).toHaveText('No brand by that name.');

  await finder.fill('noc');
  await finder.press('Enter');
  await page.waitForURL(`**/${slugs.get('Nocturne')}`);
});

test('a bar menu answers the next click at once, and one click moves to another menu', async ({ page }) => {
  await home(page);
  await page.waitForLoadState('networkidle');
  const at = async (sel: string) => {
    const b = (await page.locator(sel).boundingBox())!;
    return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)] as const;
  };
  const brands = page.locator('.sc-menu[data-state="open"]', { hasText: 'Brands' });
  const [x, y] = await at('.sc-org-btn');

  // Closed and opened again inside the closing animation: the second click
  // used to land on a page the closing menu still held, and did nothing.
  await page.mouse.click(x, y);
  await expect(brands).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  await page.mouse.click(x, y);
  await expect(brands).toBeVisible();

  // With the brand menu open, one click on New's caret is New's menu.
  const [nx, ny] = await at('.sc-new-more');
  await page.mouse.click(nx, ny);
  await expect(page.locator('.sc-start-row').first()).toBeVisible();
  await expect(brands).toHaveCount(0);
});

/** A logo drawn in the page at a given size and uploaded to the kit under a role. */
async function addLogo(p: Page, brandId: string, role: string, w: number, h: number, fill: string) {
  await p.evaluate(
    async ([id, r, width, height, colour]) => {
      const c = document.createElement('canvas');
      c.width = width as number;
      c.height = height as number;
      const g = c.getContext('2d')!;
      g.fillStyle = colour as string;
      g.fillRect(0, 0, c.width, c.height);
      const blob: Blob = await new Promise((done) => c.toBlob((b) => done(b!), 'image/png'));
      const fd = new FormData();
      fd.append('role', r as string);
      fd.append('file', new File([blob], 'logo.png', { type: 'image/png' }));
      const res = await fetch(`/api/brands/${id}/logos`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`logo upload ${res.status}`);
    },
    [brandId, role, w, h, fill] as const,
  );
}

test('a circle draws a logo it can hold, and the initial for one it cannot', async ({ page }) => {
  await home(page);
  const slugs = await addBrands(page, ['Wide Wordmark', 'Square Logo', 'Has An Icon', 'Declared Wordmark']);
  const all = (await api(page, '/api/brands')) as { id: string; slug: string }[];
  const id = (name: string) => all.find((b) => b.slug === slugs.get(name))!.id;
  await addLogo(page, id('Wide Wordmark'), 'primary', 400, 80, '#1f6feb');
  await addLogo(page, id('Square Logo'), 'primary', 200, 200, '#1f6feb');
  await addLogo(page, id('Has An Icon'), 'primary', 400, 80, '#1f6feb');
  await addLogo(page, id('Has An Icon'), 'mark', 128, 128, '#e5534b');
  await addLogo(page, id('Declared Wordmark'), 'wordmark', 400, 80, '#1f6feb');

  await page.reload();
  await openMenu(page);
  const avatar = (name: string) =>
    scroller(page)
      .locator('.sc-menu-item')
      .filter({ has: page.locator('.sc-menu-brand-lb > span:first-child', { hasText: new RegExp(`^${name}$`) }) })
      .last()
      .locator('.sc-brand-av');
  // a picture, shown, on the white plate
  const drawn = (name: string) => avatar(name).locator('img:not([hidden])');

  await expect(drawn('Square Logo')).toHaveCount(1);
  await expect(drawn('Has An Icon')).toHaveCount(1);
  // the stored icon, not the wide logo beside it: what is drawn is square
  const icon = drawn('Has An Icon');
  await expect.poll(() => icon.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  expect(await icon.evaluate((i: HTMLImageElement) => i.naturalWidth === i.naturalHeight)).toBe(true);
  // the wordmark is measured, found too wide, and the initial takes its place
  await expect(drawn('Wide Wordmark')).toHaveCount(0);
  await expect(avatar('Wide Wordmark')).toHaveText('W');
  await expect(drawn('Declared Wordmark')).toHaveCount(0);
  await expect(avatar('Declared Wordmark')).toHaveText('D');
});
